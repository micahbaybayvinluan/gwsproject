import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../common/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PriceUpdatesService } from '../notifications/price-updates.service';
import { MasterService } from './master.service';
import { dateStr, toDateOnly, todayManila } from '../common/manila';
import { D } from '../common/money';
import type { RoleKey } from '../common/permissions';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

interface CostEdit { productId: string; productName: string; costOld: string | null; costNew: string; effectiveFrom: string; reason: string }

/**
 * Direct cost editing on a product (owner request 2026-09-27). The Head Auditor or the Owner types the new cost; it applies once the
 * other of the two approves (both when someone else asks). On approval the new cost takes effect from the chosen date and the cost
 * roles are notified; cost never reaches anyone without cost access.
 */
@Injectable()
export class ProductCostService implements OnModuleInit {
  constructor(private prisma: PrismaService, private approvals: ApprovalsService, private audit: AuditService, private notify: NotificationsService, private priceUpdates: PriceUpdatesService, private master: MasterService) {}

  onModuleInit() { this.approvals.register('COST_EDIT', (req, outcome, actor) => this.onDecision(req.summary as CostEdit, outcome, req.requestedBy, actor?.id ?? null)); }

  async request(productId: string, input: { cost: number; effectiveFrom?: string; reason: string }, user: SessionUser) {
    const p = await this.prisma.db.product.findUnique({ where: { id: productId }, select: { id: true, name: true } });
    if (!p) throw new BadRequestException('Product not found');
    if (!(input.cost >= 0)) throw new BadRequestException('Cost cannot be negative');
    if (await this.prisma.db.approvalRequest.findFirst({ where: { type: 'COST_EDIT', documentId: productId, status: 'PENDING' } })) throw new BadRequestException('A cost change for this product is already waiting for approval');
    const effectiveFrom = input.effectiveFrom ?? dateStr(todayManila());
    const old = await this.master.costFor(productId, toDateOnly(effectiveFrom));
    const summary: CostEdit = { productId, productName: p.name, costOld: old == null ? null : D(old).toFixed(2), costNew: D(input.cost).toFixed(2), effectiveFrom, reason: input.reason };
    const req = await this.approvals.request({ type: 'COST_EDIT', documentType: 'Product', documentId: productId, requestedBy: user.id, requesterRole: user.roleKey as RoleKey, summary });
    return { pending: true, approvalRequestId: req.id, message: 'The new cost waits for approval.' };
  }

  private async onDecision(s: CostEdit, outcome: 'APPROVED' | 'REJECTED', requestedBy: string, actorId: string | null) {
    await requestContext.runSystem(async () => {
      if (outcome === 'REJECTED') { await this.notify.toUsers([requestedBy], { type: 'COST_EDIT_REJECTED', title: `Cost change for ${s.productName} was not approved`, link: `/products/${s.productId}` }); return; }
      const effectiveFrom = toDateOnly(s.effectiveFrom);
      await this.prisma.db.productCost.upsert({ where: { productId_effectiveFrom: { productId: s.productId, effectiveFrom } }, create: { productId: s.productId, effectiveFrom, cost: s.costNew, approvedBy: actorId }, update: { cost: s.costNew, approvedBy: actorId } });
      await this.audit.log({ action: 'COST_EDIT', entityType: 'Product', entityId: s.productId, before: { cost: s.costOld }, after: { cost: s.costNew, effectiveFrom: s.effectiveFrom, reason: s.reason } });
      await this.priceUpdates.announce([{ productId: s.productId, productName: s.productName, tier: null, oldValue: s.costOld, newValue: s.costNew }], { effectiveFrom, source: 'COST_EDIT', link: `/products/${s.productId}` });
    });
  }
}
