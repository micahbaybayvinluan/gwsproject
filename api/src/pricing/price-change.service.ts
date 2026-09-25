import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Prisma } from '@prisma/client';
import { SequenceService } from '../common/sequence.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { MasterService } from '../master/master.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { PostingService } from '../gl/posting.service';
import { r12Revaluation } from '../gl/posting-rules';
import { toDateOnly, todayManila, addDays, dateStr, isPastDate } from '../common/manila';
import { D } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

export interface PriceChangeLineInput { productId: string; tier?: string | null; newPrice?: number | null; costNew?: number | null }

/** §17 Price change process + §10.4 R12 revaluation. */
@Injectable()
export class PriceChangeService implements OnModuleInit {
  constructor(private prisma: PrismaService, private seq: SequenceService, private approvals: ApprovalsService, private master: MasterService, private notify: NotificationsService, private audit: AuditService, private posting: PostingService) {}

  onModuleInit() {
    this.approvals.register('PRICE_CHANGE', (req, outcome, actor) => this.onPriceDecision(req.documentId, outcome, actor?.id ?? null));
    this.approvals.register('REVALUATION', (req, outcome, actor) => this.onRevaluationDecision(req.documentId, outcome, actor?.id ?? null));
  }

  list() { return this.prisma.db.priceChangeDoc.findMany({ include: { lines: { include: { product: { select: { sku: true, name: true } } } } }, orderBy: { createdAt: 'desc' }, take: 200 }); }
  async get(id: string) { const d = await this.prisma.db.priceChangeDoc.findUnique({ where: { id }, include: { lines: { include: { product: { select: { sku: true, name: true, category: { select: { accountingClass: true } } } } } } } }); if (!d) throw new NotFoundException(); return d; }

  async create(input: { effectiveFrom?: string; notes?: string; lines: PriceChangeLineInput[] }, user: SessionUser) {
    const effectiveFrom = input.effectiveFrom ? toDateOnly(input.effectiveFrom) : addDays(todayManila(), 1);
    if (isPastDate(effectiveFrom)) throw new BadRequestException('effective_from cannot be in the past');
    if (!input.lines.length) throw new BadRequestException('At least one line');
    const lines: { productId: string; tier: string | null; oldPrice: Prisma.Decimal | null; newPrice: string | null; costOld: Prisma.Decimal | null; costNew: string | null }[] = [];
    for (const l of input.lines) {
      if (l.newPrice == null && l.costNew == null) throw new BadRequestException('Each line needs a new price or a new cost');
      const oldPrice = l.tier ? await this.master.priceFor(l.productId, l.tier) : null;
      const costOld = l.costNew != null ? await this.master.costFor(l.productId) : null;
      lines.push({ productId: l.productId, tier: l.tier ?? null, oldPrice, newPrice: l.newPrice != null ? D(l.newPrice).toFixed(2) : null, costOld, costNew: l.costNew != null ? D(l.costNew).toFixed(2) : null });
    }
    const doc = await this.prisma.db.$transaction(async (tx) => {
      const controlNo = await this.seq.form(tx, 'PC', null);
      const d = await tx.priceChangeDoc.create({ data: { controlNo, effectiveFrom, notes: input.notes, preparedBy: user.id, createdBy: user.id, status: 'SUBMITTED', lines: { create: lines } } });
      const req = await this.approvals.request({ type: 'PRICE_CHANGE', documentType: 'PriceChangeDoc', documentId: d.id, requestedBy: user.id, summary: { controlNo, effectiveFrom: dateStr(effectiveFrom), lines: lines.length } }, tx);
      return tx.priceChangeDoc.update({ where: { id: d.id }, data: { approvalRequestId: req.id } });
    });
    await this.audit.log({ action: 'CREATE', entityType: 'PriceChangeDoc', entityId: doc.id, after: doc });
    return this.get(doc.id);
  }

  private async onPriceDecision(docId: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const doc = await this.get(docId);
      if (doc.status !== 'SUBMITTED') return;
      if (outcome === 'REJECTED') { await this.prisma.db.priceChangeDoc.update({ where: { id: docId }, data: { status: 'REJECTED' } }); return; }
      await this.prisma.db.$transaction(async (tx) => {
        for (const l of doc.lines) {
          if (l.tier && l.newPrice != null) await tx.priceList.upsert({ where: { productId_tier_effectiveFrom: { productId: l.productId, tier: l.tier, effectiveFrom: doc.effectiveFrom } }, create: { productId: l.productId, tier: l.tier, effectiveFrom: doc.effectiveFrom, price: l.newPrice, approvedBy: actorId, sourceDocId: doc.id }, update: { price: l.newPrice, approvedBy: actorId, sourceDocId: doc.id } });
          if (l.costNew != null) await tx.productCost.upsert({ where: { productId_effectiveFrom: { productId: l.productId, effectiveFrom: doc.effectiveFrom } }, create: { productId: l.productId, effectiveFrom: doc.effectiveFrom, cost: l.costNew, approvedBy: actorId, sourceDocId: doc.id }, update: { cost: l.costNew, approvedBy: actorId, sourceDocId: doc.id } });
        }
        const needsReval = doc.lines.some((l) => l.costNew != null && l.costOld != null && D(l.costNew).gt(l.costOld));
        await tx.priceChangeDoc.update({ where: { id: docId }, data: { status: 'APPROVED', appliedAt: new Date(), revaluationStatus: needsReval ? 'PENDING' : 'NOT_NEEDED' } });
        if (needsReval) {
          const req = await this.approvals.request({ type: 'REVALUATION', documentType: 'PriceChangeDoc', documentId: docId, requestedBy: doc.preparedBy, summary: { controlNo: doc.controlNo, note: 'Non-standard treatment; recognises unrealised gain (Other Income – Price Increase).', lines: doc.lines.filter((l) => l.costNew != null).map((l) => ({ product: l.product.name, costOld: l.costOld, costNew: l.costNew })) } }, tx);
          await tx.priceChangeDoc.update({ where: { id: docId }, data: { revaluationRequestId: req.id } });
        }
      });
      await this.notifyPriceUpdate(docId);
    });
  }

  /** §17.4 notify branch/franchise users 24 h before (or immediately if same-day). Job re-runs this for docs whose notifiedAt is null. */
  async notifyPriceUpdate(docId: string) {
    const doc = await this.get(docId);
    if (doc.notifiedAt) return;
    const soon = addDays(doc.effectiveFrom, -1) <= todayManila();
    if (!soon) return;
    const title = `Price update effective ${dateStr(doc.effectiveFrom)}`;
    const body = doc.lines.filter((l) => l.tier).map((l) => `${l.product.name} (${l.tier}): ${l.oldPrice ?? '-'} → ${l.newPrice}`).join('; ');
    await this.notify.toRoles(['SALES_ASSOCIATE', 'FRANCHISE_SALES_ASSOCIATE', 'FRANCHISE_OWNER', 'HEAD_AUDITOR', 'ADMIN'], { type: 'PRICE_UPDATE', title, body, link: `/price-changes/${docId}` });
    await this.prisma.db.priceChangeDoc.update({ where: { id: docId }, data: { notifiedAt: new Date() } });
  }
  async notifyPending() { const docs = await this.prisma.db.priceChangeDoc.findMany({ where: { status: 'APPROVED', notifiedAt: null } }); for (const d of docs) await this.notifyPriceUpdate(d.id); }

  private async onRevaluationDecision(docId: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const doc = await this.get(docId);
      if (outcome === 'REJECTED') { await this.prisma.db.priceChangeDoc.update({ where: { id: docId }, data: { revaluationStatus: 'DECLINED' } }); return; }
      await this.prisma.db.$transaction(async (tx) => {
        for (const l of doc.lines) {
          if (l.costNew == null || l.costOld == null || !D(l.costNew).gt(l.costOld)) continue;
          const balances = await tx.stockBalance.findMany({ where: { productId: l.productId, qty: { gt: 0 }, location: { type: { in: ['WAREHOUSE', 'BRANCH', 'OFFICE'] } } }, include: { batch: true } });
          if (!balances.length) continue;
          const delta = D(l.costNew).minus(l.costOld);
          const entry = await tx.revaluationEntry.create({ data: { priceChangeDocId: doc.id, productId: l.productId, costOld: l.costOld, costNew: l.costNew, totalGain: delta.mul(balances.reduce((s, b) => s + b.qty, 0)).toFixed(2), lines: { create: balances.map((b) => ({ locationId: b.locationId, batchId: b.batchId, qty: b.qty, gain: delta.mul(b.qty).toFixed(2) })) } } });
          for (const b of balances) await tx.batch.update({ where: { id: b.batchId }, data: { originalUnitCost: b.batch.originalUnitCost ?? b.batch.unitCost, unitCost: l.costNew } });
          const byLoc = new Map<string, number>(); for (const b of balances) byLoc.set(b.locationId, (byLoc.get(b.locationId) ?? 0) + b.qty);
          const vouchers = await this.posting.post(tx, { type: 'RevaluationEntry', id: entry.id, date: todayManila(), createdBy: actorId }, (r) => r12Revaluation(r, { productAccountingClass: l.product.category.accountingClass, costOld: l.costOld!, costNew: l.costNew!, onHand: [...byLoc].map(([locationId, qty]) => ({ locationId, qty })), ref: doc.controlNo }));
          if (vouchers[0]) await tx.revaluationEntry.update({ where: { id: entry.id }, data: { voucherId: vouchers[0].id } });
        }
        await tx.priceChangeDoc.update({ where: { id: docId }, data: { revaluationStatus: 'APPROVED' } });
      });
      await this.audit.log({ action: 'REVALUE', entityType: 'PriceChangeDoc', entityId: docId, userId: actorId });
    });
  }
}
