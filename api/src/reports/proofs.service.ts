import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ScopeService } from '../common/scope.service';
import { StorageService } from '../attachments/storage.service';
import { dateStr, toDateOnly } from '../common/manila';
import type { SessionUser } from '../common/request-context';
import { PROOF_KINDS, ProofItem, ProofKind, proofMeta } from './proofs';

const MODE_LABEL: Record<string, string> = { CASH: 'Cash', ONLINE: 'Online', CREDIT_CARD: 'Card', AR_PDC: 'Cheque', BANK_TRANSFER: 'Bank transfer', GCASH: 'GCash', CHEQUE: 'Cheque' };
const IMAGE = /^image\/(jpeg|png|webp)$/;

/**
 * Gathers the proofs of payment of a branch (or every branch) for a period, so the reports print them by themselves and Accounting can check them
 * without paper (owner request 2026-10-09). Each proof gets a short reference (ON-1, CC-2, DS-1 …) that is printed beside its transaction.
 */
@Injectable()
export class ProofsService {
  constructor(private prisma: PrismaService, private scope: ScopeService, private storage: StorageService) {}

  /** Proofs of a day or period. `kinds` limits the types. A payment without its proof is listed as missing. */
  async collect(user: SessionUser, q: { locationId?: string | null; from: string; to: string; kinds?: ProofKind[] }): Promise<ProofItem[]> {
    const from = toDateOnly(q.from), to = toDateOnly(q.to);
    const want = (k: ProofKind) => !q.kinds?.length || q.kinds.includes(k);
    const locF = this.scope.locationFilter(user, q.locationId);
    const locWhere = (!q.locationId && !user.locationScoped) ? {} : { locationId: locF as never };
    const locs = new Map((await this.prisma.db.location.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l.name]));
    const accts = new Map((await this.prisma.db.account.findMany({ select: { id: true, title: true } })).map((a) => [a.id, a.title]));
    const out: Omit<ProofItem, 'ref' | 'kindLabel' | 'fileName' | 'contentType' | 'missing'>[] = [];
    const push = (x: Omit<ProofItem, 'ref' | 'kindLabel' | 'fileName' | 'contentType' | 'missing'>) => out.push(x);

    if (want('ONLINE') || want('CARD') || want('CHEQUE')) {
      const sales = await this.prisma.db.salesDoc.findMany({ where: { ...locWhere, docDate: { gte: from, lte: to }, voidedAt: null, OR: [{ paymentMode: { in: ['ONLINE', 'CREDIT_CARD'] } }, { paymentMode: 'AR_PDC', pdcChequeNo: { not: null } }] }, include: { customer: { select: { name: true } } }, orderBy: [{ docDate: 'asc' }, { drSiNo: 'asc' }] });
      for (const s of sales) {
        const kind: ProofKind = s.paymentMode === 'ONLINE' ? 'ONLINE' : s.paymentMode === 'CREDIT_CARD' ? 'CARD' : 'CHEQUE';
        if (!want(kind)) continue;
        push({ kind, docNo: s.drSiNo, party: s.customer?.name ?? s.customerName, mode: MODE_LABEL[s.paymentMode], account: s.paymentAccountId ? accts.get(s.paymentAccountId) ?? null : null, reference: s.paymentMode === 'CREDIT_CARD' ? [s.cardSlipNo && `slip ${s.cardSlipNo}`, s.cardApprovalCode && `appr ${s.cardApprovalCode}`].filter(Boolean).join(' · ') || null : s.pdcChequeNo ? `${s.pdcBank ?? ''} ${s.pdcChequeNo}`.trim() : null, amount: Number(s.grandTotal), date: dateStr(s.docDate), branch: locs.get(s.locationId) ?? '', locationId: s.locationId, attachmentId: s.proofOfPaymentAttachmentId, docType: 'SalesDoc', docId: s.id });
      }
    }
    if (want('COLLECTION') || want('CHEQUE')) {
      const pays = await this.prisma.db.payment.findMany({ where: { ...(locWhere as object), businessDate: { gte: from, lte: to }, voidedAt: null, status: { not: 'REJECTED' }, paymentMode: { not: 'CASH' } }, include: { customer: { select: { name: true } } }, orderBy: [{ businessDate: 'asc' }, { creditNoteNo: 'asc' }] });
      for (const p of pays) {
        const kind: ProofKind = p.paymentMode === 'AR_PDC' ? 'CHEQUE' : 'COLLECTION';
        if (!want(kind)) continue;
        push({ kind, docNo: p.creditNoteNo, party: p.customer?.name ?? null, mode: MODE_LABEL[p.paymentMode], account: p.paymentAccountId ? accts.get(p.paymentAccountId) ?? null : null, reference: null, amount: Number(p.amount), date: dateStr(p.businessDate), branch: p.locationId ? locs.get(p.locationId) ?? '' : '', locationId: p.locationId, attachmentId: p.proofAttachmentId, docType: 'Payment', docId: p.id });
      }
    }
    if (want('REPLACEMENT')) {
      const rp = await this.prisma.db.replacementPayment.findMany({ where: { ...locWhere, businessDate: { gte: from, lte: to }, status: 'APPLIED', mode: { not: 'CASH' } }, orderBy: [{ businessDate: 'asc' }, { createdAt: 'asc' }] });
      const tix = rp.length ? await this.prisma.db.replacementTicket.findMany({ where: { id: { in: rp.map((x) => x.ticketId) } }, select: { id: true, ticketNo: true, customerName: true, drSiNo: true } }) : [];
      for (const x of rp) { const t = tix.find((y) => y.id === x.ticketId); push({ kind: 'REPLACEMENT', docNo: t?.ticketNo ?? '', party: t?.customerName ?? null, mode: `${MODE_LABEL[x.mode] ?? x.mode}${x.direction === 'OUT' ? ' (refund)' : ''}`, account: x.paymentAccountId ? accts.get(x.paymentAccountId) ?? null : null, reference: x.reference ?? (t?.drSiNo ? `DR ${t.drSiNo}` : null), amount: Number(x.amount) * (x.direction === 'OUT' ? -1 : 1), date: dateStr(x.businessDate), branch: locs.get(x.locationId) ?? '', locationId: x.locationId, attachmentId: x.proofAttachmentId, docType: 'ReplacementTicket', docId: x.ticketId }); }
    }
    if (want('DEPOSIT')) {
      const dep = await this.prisma.db.cashDeposit.findMany({ where: { ...locWhere, businessDate: { gte: from, lte: to } }, orderBy: [{ businessDate: 'asc' }, { createdAt: 'asc' }] });
      for (const d of dep) push({ kind: 'DEPOSIT', docNo: `Deposit of ${dateStr(d.businessDate)}`, party: null, mode: 'Cash deposit', account: accts.get(d.bankAccountId) ?? null, reference: `deposited ${dateStr(d.depositedAt)}`, amount: Number(d.amount), date: dateStr(d.businessDate), branch: locs.get(d.locationId) ?? '', locationId: d.locationId, attachmentId: d.slipAttachmentId, docType: 'CashDeposit', docId: d.id });
    }
    if (want('FRANCHISE')) {
      const fp = await this.prisma.db.franchisePayment.findMany({ where: { paidOn: { gte: from, lte: to }, voidedAt: null, mode: { not: 'CASH' } }, include: { invoice: { select: { controlNo: true, franchiseLocationId: true } } }, orderBy: [{ paidOn: 'asc' }, { receiptNo: 'asc' }] });
      for (const x of fp) { const lid = x.invoice.franchiseLocationId; if (q.locationId ? lid !== q.locationId : user.locationScoped && !user.locationIds.includes(lid)) continue; push({ kind: 'FRANCHISE', docNo: x.receiptNo, party: locs.get(lid) ?? null, mode: MODE_LABEL[x.mode] ?? x.mode, account: x.paymentAccountId ? accts.get(x.paymentAccountId) ?? null : null, reference: x.reference ?? null, amount: Number(x.amount), date: dateStr(x.paidOn), branch: locs.get(lid) ?? '', locationId: lid, attachmentId: x.proofAttachmentId, docType: 'FranchisePayment', docId: x.id }); }
    }

    const att = out.some((x) => x.attachmentId) ? await this.prisma.db.attachment.findMany({ where: { id: { in: out.map((x) => x.attachmentId).filter((x): x is string => !!x) } }, select: { id: true, fileName: true, contentType: true } }) : [];
    const order = PROOF_KINDS.map((k) => k.kind);
    const counters = new Map<string, number>();
    return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.date.localeCompare(b.date) || a.docNo.localeCompare(b.docNo)).map((x) => {
      const m = proofMeta(x.kind); const n = (counters.get(x.kind) ?? 0) + 1; counters.set(x.kind, n);
      const a = att.find((y) => y.id === x.attachmentId);
      return { ...x, ref: `${m.code}-${n}`, kindLabel: m.label, fileName: a?.fileName ?? null, contentType: a?.contentType ?? null, missing: !a };
    });
  }

  /** The picture of each image proof as a data URL, for printing (PDFs and other files are listed with their name; they stay in the system). */
  async images(items: ProofItem[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const x of items) {
      if (!x.attachmentId || !x.contentType || !IMAGE.test(x.contentType) || map.has(x.attachmentId)) continue;
      try {
        const a = await this.prisma.db.attachment.findUnique({ where: { id: x.attachmentId }, select: { storageKey: true } }); if (!a) continue;
        const buf = await this.storage.get(a.storageKey);
        if (buf.length <= 8 * 1024 * 1024) map.set(x.attachmentId, `data:${x.contentType};base64,${buf.toString('base64')}`);
      } catch { /* a missing file prints as "file not found" */ }
    }
    return map;
  }

  async imageBuffers(items: ProofItem[]): Promise<Map<string, { buffer: Buffer; ext: 'png' | 'jpeg' }>> {
    const map = new Map<string, { buffer: Buffer; ext: 'png' | 'jpeg' }>();
    for (const x of items) {
      if (!x.attachmentId || !x.contentType || !/^image\/(jpeg|png)$/.test(x.contentType) || map.has(x.attachmentId)) continue;
      try { const a = await this.prisma.db.attachment.findUnique({ where: { id: x.attachmentId }, select: { storageKey: true } }); if (!a) continue; const buffer = await this.storage.get(a.storageKey); if (buffer.length <= 8 * 1024 * 1024) map.set(x.attachmentId, { buffer, ext: x.contentType === 'image/png' ? 'png' : 'jpeg' }); } catch { /* skip */ }
    }
    return map;
  }

  summary(items: ProofItem[]) { return PROOF_KINDS.map((k) => { const xs = items.filter((i) => i.kind === k.kind); return { ...k, count: xs.length, missing: xs.filter((i) => i.missing).length, amount: Math.round(xs.reduce((n, i) => n + i.amount, 0) * 100) / 100 }; }).filter((k) => k.count); }
}
