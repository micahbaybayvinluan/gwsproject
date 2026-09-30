import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { RoleKey, effectivePermissions } from '../common/permissions';
import type { SessionUser } from '../common/request-context';
import { dateStr, todayManila } from '../common/manila';
import { NotificationsService } from './notifications.service';

/** Supplier cost changes are told only to these roles (owner request 2026-09-26). */
export const COST_NOTIFY_ROLES: RoleKey[] = ['ADMIN', 'HEAD_AUDITOR', 'EXTERNAL_AUDITOR', 'ACCOUNTING_HEAD'];

export interface PriceChange { productId: string; productName: string; tier: string | null; oldValue?: Prisma.Decimal | number | string | null; newValue?: Prisma.Decimal | number | string | null }
const peso = (v: unknown) => (v == null ? '—' : `₱${Number(v).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);

/**
 * Price updates (owner request 2026-09-26): every selling-price change is told to each person who uses that price (a franchise
 * sees only the franchise price, branch staff their channel prices); supplier-cost changes only to Owner, Head Auditor,
 * External Auditor and Accounting Head. Each change is also logged for the dashboard.
 */
@Injectable()
export class PriceUpdatesService {
  constructor(private prisma: PrismaService, private notify: NotificationsService) {}

  async announce(changes: PriceChange[], ctx: { effectiveFrom?: Date; source: string; sourceRef?: string; link?: string }) {
    const real = changes.filter((c) => c.newValue != null && (c.oldValue == null || Number(c.oldValue) !== Number(c.newValue)));
    if (!real.length) return;
    const effectiveFrom = ctx.effectiveFrom ?? todayManila();
    await this.prisma.db.priceUpdateLog.createMany({ data: real.map((c) => ({ productId: c.productId, productName: c.productName, tier: c.tier, oldValue: c.oldValue == null ? null : String(c.oldValue), newValue: String(c.newValue), effectiveFrom, source: ctx.source, sourceRef: ctx.sourceRef ?? null, link: ctx.link ?? null })) });
    const when = dateStr(effectiveFrom);
    const list = (xs: PriceChange[], withTier: boolean) => { const shown = xs.slice(0, 8).map((c) => `${c.productName}${withTier ? ` (${c.tier})` : ''}: ${peso(c.oldValue)} → ${peso(c.newValue)}`); return shown.join('; ') + (xs.length > 8 ? `; and ${xs.length - 8} more` : ''); };

    const prices = real.filter((c) => c.tier);
    if (prices.length) {
      const users = await this.prisma.db.user.findMany({ where: { active: true }, select: { id: true, role: { select: { permissions: true } }, permissionOverrides: { select: { permissionKey: true, granted: true } } } });
      for (const u of users) {
        const perms = effectivePermissions(u.role.permissions as string[], u.permissionOverrides);
        const mine = prices.filter((c) => perms.has(`price.view.${c.tier}`));
        if (mine.length) await this.notify.toUsers([u.id], { type: 'PRICE_UPDATE', title: `Price update effective ${when}: ${mine.length} item(s)`, body: list(mine, new Set(mine.map((c) => c.tier)).size > 1), link: ctx.link ?? '/products' });
      }
    }
    const costs = real.filter((c) => !c.tier);
    if (costs.length) await this.notify.toRoles(COST_NOTIFY_ROLES, { type: 'COST_UPDATE', title: `Supplier cost change effective ${when}: ${costs.length} item(s)`, body: list(costs, false), link: ctx.link ?? '/products' });
  }

  /** Dashboard list: the last 14 days of changes this person may see. */
  async recentFor(user: SessionUser) {
    const since = new Date(Date.now() - 14 * 86400000);
    const rows = await this.prisma.db.priceUpdateLog.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 300 });
    const costOk = COST_NOTIFY_ROLES.includes(user.roleKey as RoleKey);
    return rows.filter((r) => (r.tier ? user.permissions.has(`price.view.${r.tier}`) : costOk)).slice(0, 25)
      .map((r) => ({ id: r.id, product: r.productName, what: r.tier ? `${r.tier} price` : 'Supplier cost', oldValue: r.oldValue, newValue: r.newValue, effectiveFrom: dateStr(r.effectiveFrom), link: r.link, at: r.createdAt }));
  }
}
