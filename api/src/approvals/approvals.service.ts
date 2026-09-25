import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ApprovalStatus, Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { APPROVAL_ROUTING, ApprovalType, RoleKey, editRequestApprovers } from '../common/permissions';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

export type ApprovalOutcome = 'APPROVED' | 'REJECTED';
export type ApprovalHandler = (req: { id: string; type: string; documentType: string; documentId: string; requestedBy: string; summary: unknown }, outcome: ApprovalOutcome, actor: { id: string; note?: string } | null) => Promise<void>;

/**
 * §6 Generic approval engine. Modules register a handler per type; the engine calls it once the request is
 * finally APPROVED (all required roles, or any-one when anyOf) or REJECTED (any listed role).
 */
@Injectable()
export class ApprovalsService {
  private log = new Logger('Approvals');
  private handlers = new Map<string, ApprovalHandler>();
  constructor(private prisma: PrismaService, private notify: NotificationsService, private audit: AuditService) {}

  register(type: ApprovalType, handler: ApprovalHandler) { this.handlers.set(type, handler); }

  async request(input: { type: ApprovalType; documentType: string; documentId: string; requestedBy: string; requesterRole?: RoleKey; summary?: unknown; autoApproveAt?: Date | null; extraRoles?: RoleKey[]; discrepancyCaseId?: string | null; approverUserIds?: string[] }, tx: Tx | null = null) {
    const db = (tx ?? this.prisma.db);
    const route = APPROVAL_ROUTING[input.type];
    let roles: RoleKey[] = [...route.roles];
    if (input.type === 'EDIT_REQUEST' && input.requesterRole) roles = editRequestApprovers(input.requesterRole);
    if (input.extraRoles?.length) roles = [...new Set([...roles, ...input.extraRoles])];
    const userIds = [...new Set(input.approverUserIds ?? [])];
    if (userIds.length) roles = [];
    const req = await db.approvalRequest.create({
      data: {
        type: input.type, documentType: input.documentType, documentId: input.documentId, requestedBy: input.requestedBy,
        requiredApproverRoles: roles, requiredApproverUserIds: userIds, anyOf: !!route.anyOf && !input.extraRoles?.length, summary: (input.summary ?? undefined) as Prisma.InputJsonValue | undefined,
        autoApproveAt: input.autoApproveAt ?? null, discrepancyCaseId: input.discrepancyCaseId ?? null,
      },
    });
    // notify approvers (after commit when in tx — best effort)
    const message = { type: 'APPROVAL_REQUESTED', title: `${humanType(input.type)} needs your ${userIds.length ? 'acceptance' : 'approval'}`, body: `${input.documentType} ${summaryLine(input.summary)}`, link: `/approvals?type=${input.type}` };
    const doNotify = () => (userIds.length ? this.notify.toUsers(userIds, message) : this.notify.toRoles(roles, message)).catch((e) => this.log.warn(e));
    if (tx) setImmediate(doNotify); else await doNotify();
    return req;
  }

  /** Inbox for the current approver: pending requests where one of their roles is required and they have not decided yet. */
  async inbox(user: SessionUser, type?: string) {
    const byRole: Prisma.ApprovalRequestWhereInput = { requiredApproverRoles: { has: user.roleKey }, requiredApproverUserIds: { isEmpty: true } };
    if (user.roleKey === 'FRANCHISE_OWNER') {
      // franchise owner only sees requests for their own franchise (summary.locationId)
      byRole.summary = { path: ['locationId'], string_contains: user.locationIds[0] ?? '∅' } as never;
    }
    const where: Prisma.ApprovalRequestWhereInput = { status: 'PENDING', type: type || undefined, decisions: { none: { userId: user.id } }, OR: [byRole, { requiredApproverUserIds: { has: user.id } }] };
    const rows = await this.prisma.db.approvalRequest.findMany({ where, include: { decisions: { include: { user: { select: { fullName: true } } } } }, orderBy: { createdAt: 'desc' } });
    const oldest = rows.length ? Math.floor((Date.now() - Math.min(...rows.map((r) => r.createdAt.getTime()))) / 86400000) : 0;
    const requesterIds = [...new Set(rows.map((r) => r.requestedBy))];
    const requesters = await this.prisma.db.user.findMany({ where: { id: { in: requesterIds } }, select: { id: true, fullName: true } });
    const byId = new Map(requesters.map((u) => [u.id, u.fullName]));
    return { count: rows.length, oldestDays: oldest, items: rows.map((r) => ({ ...r, requesterName: byId.get(r.requestedBy) ?? r.requestedBy })) };
  }
  async mine(userId: string) { return this.prisma.db.approvalRequest.findMany({ where: { requestedBy: userId }, include: { decisions: true }, orderBy: { createdAt: 'desc' }, take: 100 }); }
  async get(id: string) { const r = await this.prisma.db.approvalRequest.findUnique({ where: { id }, include: { decisions: { include: { user: { select: { fullName: true } } } } } }); if (!r) throw new NotFoundException(); return r; }
  forDocument(documentType: string, documentId: string) { return this.prisma.db.approvalRequest.findMany({ where: { documentType, documentId }, include: { decisions: { include: { user: { select: { fullName: true } } } } }, orderBy: { createdAt: 'desc' } }); }

  async decide(id: string, user: SessionUser, decision: 'APPROVE' | 'REJECT', note?: string) {
    const req = await this.get(id);
    if (req.status !== 'PENDING') throw new BadRequestException('Request already decided');
    const targeted = (req.requiredApproverUserIds ?? []).length > 0;
    if (targeted) {
      // person-targeted request: only the named person decides (their role does not matter)
      if (!req.requiredApproverUserIds.includes(user.id)) throw new ForbiddenException('This request is addressed to another person');
    } else {
      if (!req.requiredApproverRoles.includes(user.roleKey)) throw new ForbiddenException('Your role is not an approver for this request');
      if (!user.permissions.has(`approval.act.${req.type}`)) throw new ForbiddenException(`Missing permission approval.act.${req.type}`);
    }
    if (req.decisions.some((d) => d.userId === user.id)) throw new BadRequestException('You already decided on this request');
    await this.prisma.db.approvalDecision.create({ data: { requestId: id, userId: user.id, roleKey: user.roleKey, decision, note } });
    const decisions = [...req.decisions.map((d) => ({ roleKey: d.roleKey, decision: d.decision })), { roleKey: user.roleKey, decision }];
    let final: ApprovalStatus | null = null;
    if (decision === 'REJECT') final = 'REJECTED';
    else if (targeted) { const approvedUsers = new Set([...req.decisions.filter((d) => d.decision === 'APPROVE').map((d) => d.userId), user.id]); if (req.requiredApproverUserIds.every((u) => approvedUsers.has(u))) final = 'APPROVED'; }
    else if (req.anyOf) final = 'APPROVED';
    else {
      const approvedRoles = new Set(decisions.filter((d) => d.decision === 'APPROVE').map((d) => d.roleKey));
      if (req.requiredApproverRoles.every((r) => approvedRoles.has(r))) final = 'APPROVED';
    }
    await this.audit.log({ action: decision, entityType: 'ApprovalRequest', entityId: id, after: { type: req.type, documentType: req.documentType, documentId: req.documentId, note } });
    if (final) await this.finalize(req.id, final, { id: user.id, note });
    return this.get(id);
  }

  /** Bulk approve/reject with one note (§6.2). Mixed selection allowed; per-item errors are reported, not thrown. */
  async decideBulk(ids: string[], user: SessionUser, decision: 'APPROVE' | 'REJECT', note?: string) {
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      try { await this.decide(id, user, decision, note); results.push({ id, ok: true }); }
      catch (e) { results.push({ id, ok: false, error: (e as Error).message }); }
    }
    return results;
  }

  private async finalize(id: string, status: ApprovalStatus, actor: { id: string; note?: string } | null) {
    const req = await this.prisma.db.approvalRequest.update({ where: { id }, data: { status, decidedAt: new Date() } });
    const handler = this.handlers.get(req.type);
    const outcome: ApprovalOutcome = status === 'REJECTED' ? 'REJECTED' : 'APPROVED';
    if (handler) {
      try { await handler({ id: req.id, type: req.type, documentType: req.documentType, documentId: req.documentId, requestedBy: req.requestedBy, summary: req.summary }, outcome, actor); }
      catch (e) {
        this.log.error(`Handler for ${req.type} failed: ${(e as Error).message}`);
        await this.prisma.db.approvalRequest.update({ where: { id }, data: { status: 'PENDING', decidedAt: null } });
        throw e;
      }
    }
    await this.notify.toUsers([req.requestedBy], { type: 'APPROVAL_DECIDED', title: `${humanType(req.type)} ${outcome.toLowerCase()}`, body: actor?.note ?? undefined, link: documentLink(req.documentType, req.documentId) });
  }

  /** Job: auto-approve untouched requests whose autoApproveAt has passed (§6.1 COST_ON_RECEIVING 24 h). */
  async runAutoApprovals() {
    const due = await this.prisma.db.approvalRequest.findMany({ where: { status: 'PENDING', autoApproveAt: { lte: new Date() } } });
    let n = 0;
    for (const r of due) {
      await requestContext.runSystem(async () => {
        await this.audit.log({ action: 'AUTO_APPROVE', entityType: 'ApprovalRequest', entityId: r.id, after: { reason: 'auto-approved (unchanged cost)' }, userId: null });
        await this.finalize(r.id, 'AUTO_APPROVED', null);
      });
      n++;
    }
    return { autoApproved: n };
  }

  /** Reminder job: cost approvals pending > 12 h → Head Auditor; > 24 h → Admin (§12). */
  async remindStaleCostApprovals() {
    const now = Date.now();
    const pending = await this.prisma.db.approvalRequest.findMany({ where: { status: 'PENDING', type: 'COST_ON_RECEIVING' } });
    for (const p of pending) {
      const hours = (now - p.createdAt.getTime()) / 3600000;
      if (hours >= 24) await this.notify.toRoles(['ADMIN'], { type: 'APPROVAL_STALE', title: 'Cost approval pending > 24 h', link: '/approvals?type=COST_ON_RECEIVING' });
      else if (hours >= 12) await this.notify.toRoles(['HEAD_AUDITOR'], { type: 'APPROVAL_STALE', title: 'Cost approval pending > 12 h', link: '/approvals?type=COST_ON_RECEIVING' });
    }
  }

  async cancelForDocument(documentType: string, documentId: string) {
    await this.prisma.db.approvalRequest.updateMany({ where: { documentType, documentId, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: new Date() } });
  }
}

export function humanType(t: string) { return t.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()); }
function summaryLine(s: unknown) { if (!s || typeof s !== 'object') return ''; const o = s as Record<string, unknown>; return [o.controlNo, o.locationName, o.total != null ? `₱${o.total}` : null].filter(Boolean).join(' · '); }
export function documentLink(type: string, id: string) {
  const map: Record<string, string> = { ReceivingDoc: '/receiving', TransferDoc: '/transfers', SalesDoc: '/sales', ExpiryWriteoffDoc: '/writeoffs', PriceChangeDoc: '/price-changes', PostCloseEdit: '/post-close-edits', CountDoc: '/counts', DiscrepancyCase: '/discrepancies', AccountingPeriod: '/accounting/periods', BeginningBalance: '/accounting/beginning-balances' };
  return `${map[type] ?? '/'}/${id}`;
}
