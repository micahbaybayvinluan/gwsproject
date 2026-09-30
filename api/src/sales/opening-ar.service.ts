import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { FranchiseArService } from '../franchise/franchise-ar.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { dateStr, toDateOnly, todayManila } from '../common/manila';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

export interface OpeningArInput {
  locationId: string; kind: 'DEALER' | 'FRANCHISE' | 'AGENT' | 'OTHER';
  customerId?: string | null; agentId?: string | null; customerName?: string | null;
  drSiNo: string; docDate: string; dueDate: string; amount: number;
  pdcBank?: string | null; pdcChequeNo?: string | null; pdcDate?: string | null; notes?: string | null;
}

const CHANNEL = { DEALER: 'DEALER', FRANCHISE: 'FRANCHISE', AGENT: 'AGENT', OTHER: 'OTHER' } as const;

/**
 * AR from before GWS-ERP (owner request 2026-09-29). The Accounting Head or Associate enters each open invoice for any branch; the Owner
 * approves (tick all in My Approvals). On approval it becomes an AR / PDC sales document without stock lines, so it shows in that branch's
 * AR & Collections, reminders and collections like any other credit sale, and the branch is notified. No journal entry: the AR beginning
 * balance already sits in Periods & Opening. The Excel "Open AR" import goes through the same approval.
 */
@Injectable()
export class OpeningArService implements OnModuleInit {
  constructor(private prisma: PrismaService, private approvals: ApprovalsService, private notify: NotificationsService, private franchiseAr: FranchiseArService) {}

  onModuleInit() { this.approvals.register('OPENING_AR', (r, outcome, actor) => this.onDecision(r.documentId, outcome, actor?.note ?? null)); }

  async create(input: OpeningArInput, user: SessionUser) {
    const db = this.prisma.db;
    const loc = await db.location.findUnique({ where: { id: input.locationId } });
    if (!loc || loc.type === 'VIRTUAL') throw new BadRequestException('Choose the branch the invoice belongs to');
    const drSiNo = input.drSiNo.trim();
    if (!drSiNo) throw new BadRequestException('Type the DR / SI number');
    if (!(input.amount > 0)) throw new BadRequestException('The amount must be more than zero');
    const docDate = toDateOnly(input.docDate); const dueDate = toDateOnly(input.dueDate);
    if (docDate > todayManila()) throw new BadRequestException('The invoice date cannot be in the future: opening AR is for invoices made before GWS-ERP');
    if (dueDate < docDate) throw new BadRequestException('The due date cannot be before the invoice date');
    let name = input.customerName?.trim() || null;
    if (input.kind === 'AGENT') {
      if (!input.agentId) throw new BadRequestException('Choose the agent');
      const a = await db.agent.findUnique({ where: { id: input.agentId } }); if (!a) throw new BadRequestException('Agent not found'); name = a.name;
    } else if (input.customerId) {
      const c = await db.customer.findUnique({ where: { id: input.customerId } }); if (!c) throw new BadRequestException('Customer not found');
      if (input.kind !== 'OTHER' && c.type !== input.kind) throw new BadRequestException(`${c.name} is not a ${input.kind.toLowerCase()}`);
      name = c.name;
    } else if (input.kind !== 'OTHER' || !name) throw new BadRequestException(input.kind === 'OTHER' ? 'Choose the customer or type the name' : `Choose the ${input.kind === 'DEALER' ? 'dealer' : 'franchisee'}`);
    const pdc = input.pdcChequeNo?.trim() || input.pdcBank?.trim() || input.pdcDate;
    if (pdc && (!input.pdcChequeNo?.trim() || !input.pdcDate)) throw new BadRequestException('A PDC needs the cheque no. and the cheque date');
    const dup = (await db.salesDoc.findFirst({ where: { locationId: loc.id, drSiNo } })) ?? (await db.openingArEntry.findFirst({ where: { locationId: loc.id, drSiNo, status: 'PENDING' } }));
    if (dup) throw new BadRequestException(`DR / SI ${drSiNo} is already recorded for ${loc.name}`);

    const e = await db.openingArEntry.create({ data: {
      locationId: loc.id, kind: input.kind, customerId: input.kind === 'AGENT' ? null : input.customerId ?? null, agentId: input.kind === 'AGENT' ? input.agentId! : null,
      customerName: name, drSiNo, docDate, dueDate, amount: input.amount.toFixed(2),
      pdcBank: pdc ? input.pdcBank?.trim() || null : null, pdcChequeNo: pdc ? input.pdcChequeNo!.trim() : null, pdcDate: pdc ? toDateOnly(input.pdcDate!) : null,
      notes: input.notes?.trim() || null, createdBy: user.id,
    } });
    const req = await this.approvals.request({ type: 'OPENING_AR', documentType: 'OpeningArEntry', documentId: e.id, requestedBy: user.id, summary: {
      controlNo: `Opening AR · DR/SI ${drSiNo}`, drSiNo, locationName: `${loc.name}${loc.type === 'FRANCHISE' ? ' (franchise)' : ''} · ${name}`, total: input.amount.toFixed(2),
      customer: name, docDate: dateStr(docDate), dueDate: dateStr(dueDate), pdc: pdc ? `${input.pdcBank ?? ''} ${input.pdcChequeNo} ${input.pdcDate}`.trim() : null,
    } });
    await db.openingArEntry.update({ where: { id: e.id }, data: { approvalRequestId: req.id } });
    if (user.roleKey === 'ADMIN') await this.approvals.decide(req.id, user, 'APPROVE', 'Entered by the Owner');
    return db.openingArEntry.findUniqueOrThrow({ where: { id: e.id } });
  }

  private async onDecision(id: string, outcome: 'APPROVED' | 'REJECTED', note: string | null) {
    const e = await requestContext.runSystem(async () => {
      const db = this.prisma.db;
      const e = await db.openingArEntry.findUniqueOrThrow({ where: { id } });
      if (e.status !== 'PENDING') return null;
      if (outcome === 'REJECTED') { await db.openingArEntry.update({ where: { id }, data: { status: 'REJECTED', decidedAt: new Date(), decisionNote: note } }); return { ...e, status: 'REJECTED' }; }
      const loc = await db.location.findUniqueOrThrow({ where: { id: e.locationId } });
      if (await db.salesDoc.findFirst({ where: { locationId: e.locationId, drSiNo: e.drSiNo } })) throw new BadRequestException(`DR / SI ${e.drSiNo} is already recorded for ${loc.name}`);
      // a franchisee's old balance becomes a franchise invoice: the franchise owner sees it in Franchise AR and the memo's penalty and interest apply once it is overdue
      if (e.kind === 'FRANCHISE' && e.customerId) {
        const cust = await db.customer.findUnique({ where: { id: e.customerId } });
        if (cust?.locationId) {
          const inv = await this.franchiseAr.createOpening(db as never, { franchiseLocationId: cust.locationId, fromLocationId: e.locationId, drSiNo: e.drSiNo, docDate: e.docDate, dueDate: e.dueDate, amount: e.amount, notes: `Opening AR (before GWS-ERP)${e.notes ? ` · ${e.notes}` : ''}` }, e.createdBy);
          await db.openingArEntry.update({ where: { id }, data: { status: 'APPROVED', decidedAt: new Date(), decisionNote: note } });
          await this.franchiseAr.tell(cust.locationId, { type: 'FRANCHISE_INVOICE', title: `Old balance recorded for the franchise: ${inv.controlNo} ${e.amount.toString()} due ${dateStr(e.dueDate)}`, body: 'Penalty and interest apply after the due date (memo of July 31, 2026).', link: `/franchise-ar?invoice=${inv.id}` });
          return { ...e, status: 'APPROVED', locName: loc.name };
        }
      }
      const doc = await db.salesDoc.create({ data: {
        controlNo: `OPEN-AR-${loc.code}-${e.drSiNo}`, docDate: e.docDate, locationId: e.locationId, channel: CHANNEL[e.kind as keyof typeof CHANNEL] ?? 'OTHER',
        customerId: e.customerId, agentId: e.agentId, customerName: e.customerName, drSiNo: e.drSiNo, paymentMode: 'AR_PDC',
        productTotal: e.amount, grandTotal: e.amount, dueDate: e.dueDate, pdcBank: e.pdcBank, pdcChequeNo: e.pdcChequeNo, pdcDate: e.pdcDate,
        preparedBy: e.createdBy, createdBy: e.createdBy, notes: `Opening AR (before GWS-ERP)${e.notes ? ` · ${e.notes}` : ''}`,
      } });
      await db.openingArEntry.update({ where: { id }, data: { status: 'APPROVED', salesDocId: doc.id, decidedAt: new Date(), decisionNote: note } });
      return { ...e, status: 'APPROVED', locName: loc.name };
    });
    if (e?.status === 'APPROVED') {
      await this.notify.toLocation(e.locationId, { type: 'OPENING_AR', title: `Opening AR added to ${'locName' in e ? e.locName : 'your branch'}: ${e.customerName} · DR/SI ${e.drSiNo} · ₱${Number(e.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`, body: `From before GWS-ERP, due ${dateStr(e.dueDate)}. Collect it in AR & Collections like any credit sale.`, link: `/ar?locationId=${e.locationId}` });
    }
  }

  list(q: { status?: string; locationId?: string }) {
    return this.prisma.db.openingArEntry.findMany({ where: { status: q.status || undefined, locationId: q.locationId || undefined }, orderBy: { createdAt: 'desc' }, take: 500 })
      .then(async (rows) => {
        const locs = new Map((await this.prisma.db.location.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.locationId))] } }, select: { id: true, name: true, type: true } })).map((l) => [l.id, l]));
        const users = new Map((await this.prisma.db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdBy))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
        return rows.map((r) => ({ ...r, docDate: dateStr(r.docDate), dueDate: dateStr(r.dueDate), pdcDate: r.pdcDate ? dateStr(r.pdcDate) : null, location: locs.get(r.locationId) ?? null, createdByName: users.get(r.createdBy) ?? null }));
      });
  }
}
