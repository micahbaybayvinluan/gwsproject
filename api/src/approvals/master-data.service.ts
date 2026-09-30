import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { SessionUser } from '../common/request-context';
import { LOCATION_SCOPED_ROLES, RoleKey, effectivePermissions } from '../common/permissions';
import { requestContext } from '../common/request-context';
import { ApprovalsService } from './approvals.service';

type Apply = (payload: Record<string, unknown>, requestedBy: string) => Promise<{ id: string } & Record<string, unknown>>;
export interface MasterKind { label: string; apply: Apply; link?: (id: string) => string }
export type Pending = { pending: true; approvalRequestId: string; message: string };

/**
 * New master data (owner request 2026-09-26): products, suppliers, categories, customers, agents, riders, branches, accounts,
 * employees and user accounts entered by anyone other than the Owner (Admin) are held as a MASTER_DATA_NEW request and
 * created only when the Owner approves. The Owner's own entries are created at once.
 */
@Injectable()
export class MasterDataApprovals implements OnModuleInit {
  private kinds = new Map<string, MasterKind>();
  constructor(private prisma: PrismaService, private approvals: ApprovalsService, private notify: NotificationsService) {}

  onModuleInit() {
    this.approvals.register('MASTER_DATA_NEW', async (req, outcome, actor) => {
      const s = req.summary as { kind: string; name?: string; _payload: Record<string, unknown> };
      const kind = this.kinds.get(s.kind);
      if (outcome === 'APPROVED') {
        if (!kind) throw new Error(`Unknown master data kind ${s.kind}`);
        const created = await requestContext.runSystem(() => kind.apply(s._payload, req.requestedBy));
        await this.prisma.db.approvalRequest.update({ where: { id: req.id }, data: { documentId: created.id, summary: { ...(req.summary as object), createdId: created.id } } });
        await this.notify.toUsers([req.requestedBy], { type: 'MASTER_DATA_APPROVED', title: `The Owner approved the new ${kind.label.toLowerCase()}: ${s.name ?? ''}`, link: kind.link?.(created.id) });
      } else {
        await this.notify.toUsers([req.requestedBy], { type: 'MASTER_DATA_REJECTED', title: `The Owner rejected the new ${kind?.label.toLowerCase() ?? 'item'}: ${s.name ?? ''}`, body: actor?.note });
      }
    });
  }

  registerKind(key: string, kind: MasterKind) { this.kinds.set(key, kind); }

  /** The requester as a SessionUser, for creators that check permissions (bulk imports) when the Owner approves later. */
  async sessionUserOf(userId: string): Promise<SessionUser> {
    const u = await this.prisma.db.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true, assignments: true, permissionOverrides: true } });
    const roleKey = u.role.key as RoleKey;
    return { id: u.id, username: u.username, fullName: u.fullName, roleKey, permissions: effectivePermissions(u.role.permissions as string[], u.permissionOverrides), locationIds: u.assignments.map((a) => a.locationId), locationScoped: LOCATION_SCOPED_ROLES.includes(roleKey), sessionId: 'approval', totpVerified: true };
  }

  /** Owner → created now. Anyone else → approval request; `show` is what the Owner sees in the inbox. */
  async submit<T extends { id: string }>(key: string, payload: Record<string, unknown>, user: SessionUser, show: Record<string, string | number | boolean | null | undefined>, createNow: () => Promise<T>): Promise<T | Pending> {
    if (user.roleKey === 'ADMIN') return createNow();
    const kind = this.kinds.get(key);
    if (!kind) throw new Error(`Unknown master data kind ${key}`);
    const clean = Object.fromEntries(Object.entries(show).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    const req = await this.approvals.request({ type: 'MASTER_DATA_NEW', documentType: 'MasterData', documentId: randomUUID(), requestedBy: user.id, summary: { kind: key, kindLabel: kind.label, ...clean, requestedByName: user.fullName, _payload: payload } });
    return { pending: true, approvalRequestId: req.id, message: `Sent to the Owner for approval. The new ${kind.label.toLowerCase()} is created once approved.` };
  }

  /** Requests still waiting, to show "pending approval" rows in lists. */
  async pendingOf(key: string) {
    const rows = await this.prisma.db.approvalRequest.findMany({ where: { type: 'MASTER_DATA_NEW', status: 'PENDING', summary: { path: ['kind'], equals: key } }, select: { id: true, summary: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
    // names only: the staged payload (prices, cost) stays with the Owner's approval
    return rows.map((r) => { const s = r.summary as { name?: string; requestedByName?: string }; return { approvalRequestId: r.id, name: s.name ?? '', requestedByName: s.requestedByName ?? '', createdAt: r.createdAt }; });
  }
}
