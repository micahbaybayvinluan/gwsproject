import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../common/prisma.service';
import { CashFundService } from '../cashfund/cashfund.service';
import { PdfService } from './pdf.service';
import { dateStr, todayManila, toDateOnly } from '../common/manila';
import { D } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

export interface FundLine { voucher: number; date: string; books: string; reference: string; remarks: string; name: string; code: string; title: string; debit: number; credit: number; money: boolean }
const IN_KINDS = ['SETUP', 'TOP_UP', 'REPLENISH', 'ADVANCE_IN', 'ADVANCE_RETURN', 'FRANCHISE_RECEIPT'];
const KIND_LABEL: Record<string, string> = { SETUP: 'Cash fund set up', TOP_UP: 'Cash fund topped up', REPLENISH: 'Cash fund replenished', ADVANCE_IN: 'Additional cash fund', ADVANCE_OUT: 'Cash fund pull-out (to be returned)', ADVANCE_RETURN: 'Pull-out paid back', FRANCHISE_RECEIPT: 'Franchise shipping payment', EXPENSE_VOID: 'Expense voided' };
const c2 = (n: unknown) => Math.round(Number(n) * 100) / 100;

/**
 * The cash fund ledger in the company's voucher format (owner request 2026-10-23): one voucher number per day, two lines per movement
 * (the expense / advance account and Petty Cash), with the person, the account code and title, and the debit and credit columns.
 */
@Injectable()
export class CashFundReportService {
  constructor(private prisma: PrismaService, private funds: CashFundService, private pdf: PdfService) {}

  async build(idOrLocation: string, q: { from?: string; to?: string }, user: SessionUser) {
    const f = await this.funds.findFund(idOrLocation); if (!f) throw new NotFoundException('No cash fund set up for this location');
    if (user.locationScoped && !user.locationIds.includes(f.locationId)) throw new ForbiddenException();
    if (!this.funds.canUse(user, f)) throw new ForbiddenException('This cash fund is kept by the warehouse custodians');
    const from = q.from ? toDateOnly(q.from) : new Date(Date.UTC(todayManila().getUTCFullYear(), todayManila().getUTCMonth(), 1)); const to = q.to ? toDateOnly(q.to) : todayManila();
    if (from > to) throw new BadRequestException('The first date is after the last date');
    const all = await this.prisma.db.cashFundTxn.findMany({ where: { fundId: f.id, businessDate: { lte: to } }, orderBy: [{ businessDate: 'asc' }, { createdAt: 'asc' }] });
    const days = [...new Set(all.map((t) => dateStr(t.businessDate)))].sort(); const voucherOf = (d: string) => f.voucherStart + days.indexOf(d);
    const inRange = all.filter((t) => t.businessDate >= from);
    const exp = await requestContext.runSystem(async () => await this.prisma.db.expenseDoc.findMany({ where: { id: { in: inRange.map((t) => t.expenseDocId).filter((x): x is string => !!x) } }, select: { id: true, accountId: true, payee: true, notes: true, controlNo: true } }));
    const drIds = inRange.map((t) => t.salesDocId).filter((x): x is string => !!x);
    const drs = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findMany({ where: { id: { in: drIds } }, select: { id: true, drSiNo: true, customerName: true, customer: { select: { name: true } } } }));
    const petty = f.accountId ?? (await this.prisma.db.account.findFirst({ where: { branchTagId: f.locationId, template: { key: 'PETTY_CASH' } }, select: { id: true } }))?.id ?? null;
    const acctIds = [...new Set([petty, ...inRange.map((t) => t.counterAccountId), ...exp.map((e) => e.accountId)].filter((x): x is string => !!x))];
    const accts = new Map((await this.prisma.db.account.findMany({ where: { id: { in: acctIds } }, select: { id: true, code: true, title: true } })).map((a) => [a.id, a]));
    const pt = petty ? accts.get(petty) : null; const books = f.name;
    const lines: FundLine[] = [];
    const push = (t: (typeof inRange)[number], debitAcct: { code: string; title: string }, creditAcct: { code: string; title: string }, amount: number, remarks: string, name: string, reference: string, money: boolean) => {
      const base = { voucher: voucherOf(dateStr(t.businessDate)), date: dateStr(t.businessDate), books, reference, remarks, name, money };
      lines.push({ ...base, code: debitAcct.code, title: debitAcct.title, debit: amount, credit: 0 }); lines.push({ ...base, code: creditAcct.code, title: creditAcct.title, debit: 0, credit: amount });
    };
    const pettyAcct = { code: pt?.code ?? '', title: pt?.title ?? `Petty Cash - ${f.location.name}` };
    for (const t of inRange) {
      const amt = c2(D(t.amount).abs()); if (!amt) continue;
      const dr = drs.find((d) => d.id === t.salesDocId);
      const counter = (id: string | null) => (id && accts.get(id)) || { code: '', title: '(account not recorded)' };
      const ref = t.reference || t.controlNo || (dr ? `DR ${dr.drSiNo}` : '');
      if (t.kind === 'EXPENSE' || t.kind === 'EXPENSE_VOID') {
        const e = exp.find((x) => x.id === t.expenseDocId); const ea = counter(e?.accountId ?? null);
        const remarks = `${e?.notes || ea.title}${dr ? ` (DR ${dr.drSiNo})` : ''}${t.kind === 'EXPENSE_VOID' ? ' – voided, money returned' : ''}`;
        if (t.kind === 'EXPENSE') push(t, ea, pettyAcct, amt, remarks, e?.payee ?? '', e?.controlNo ?? ref, false); else push(t, pettyAcct, ea, amt, remarks, e?.payee ?? '', e?.controlNo ?? ref, false);
      } else {
        const out = t.kind === 'ADVANCE_OUT' || (t.kind === 'TOP_UP' && D(t.amount).isNeg()); const ca = counter(t.counterAccountId);
        const who = t.personName || (dr ? (dr.customer?.name ?? dr.customerName ?? '') : '');
        const remarks = t.notes && t.kind !== 'SETUP' && t.kind !== 'FRANCHISE_RECEIPT' ? t.notes : (KIND_LABEL[t.kind] ?? t.kind).toUpperCase() + (t.notes && t.kind === 'FRANCHISE_RECEIPT' ? ` – ${t.notes}` : '');
        if (out) push(t, ca, pettyAcct, amt, remarks, who, ref, true); else push(t, pettyAcct, ca, amt, remarks, who, ref, IN_KINDS.includes(t.kind));
      }
    }
    const opening = all.filter((t) => t.businessDate < from).reduce((n, t) => n.plus(t.amount), D(0));
    const debit = lines.reduce((n, l) => n + l.debit, 0); const credit = lines.reduce((n, l) => n + l.credit, 0);
    return { fund: { id: f.id, name: f.name, location: f.location.name }, from: dateStr(from), to: dateStr(to), openingBalance: opening.toFixed(2), balance: D(f.balance).toFixed(2), lines, totals: { debit: c2(debit), credit: c2(credit) } };
  }

  async xlsx(idOrLocation: string, q: { from?: string; to?: string }, user: SessionUser) {
    const r = await this.build(idOrLocation, q, user);
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Cash fund');
    const heads: [string, number, string][] = [['Voucher', 9, 'FFFDE68A'], ['Date', 12, 'FF93C5FD'], ['Books:', 24, 'FFC4B5FD'], ['Reference', 14, 'FF93C5FD'], ['Remarks:', 62, 'FFFBCFE8'], ['Name:', 16, 'FFFBCFE8'], ['Code', 8, 'FF86EFAC'], ['Account Title', 52, 'FFFBCFE8'], ['Php Debit', 14, 'FFFDE68A'], ['Php Credit', 14, 'FF86EFAC']];
    ws.addRow(heads.map((h) => h[0])); heads.forEach((h, i) => { const c = ws.getRow(1).getCell(i + 1); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: h[2] } }; c.font = { bold: true, name: 'Times New Roman' }; c.border = { bottom: { style: 'thin' }, top: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }; ws.getColumn(i + 1).width = h[1]; });
    for (const l of r.lines) {
      const row = ws.addRow([l.voucher, new Date(`${l.date}T00:00:00Z`), l.books, l.reference, l.remarks, l.name, l.code, l.title, l.debit || null, l.credit || null]);
      row.getCell(2).numFmt = 'mm/dd/yy'; row.getCell(9).numFmt = '#,##0.00'; row.getCell(10).numFmt = '#,##0.00';
      row.eachCell((c) => { c.border = { bottom: { style: 'hair' } }; if (l.money) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0ABFC' } }; });
    }
    const t = ws.addRow(['', '', '', '', 'TOTAL', '', '', '', r.totals.debit, r.totals.credit]); t.font = { bold: true }; t.getCell(9).numFmt = '#,##0.00'; t.getCell(10).numFmt = '#,##0.00';
    ws.addRow([]); ws.addRow(['', '', '', '', `${r.fund.name} · ${r.from} to ${r.to} · balance now ₱${Number(r.balance).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`]);
    ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = { from: 'A1', to: 'J1' };
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: `CashFund-${r.fund.name.replace(/[^A-Za-z0-9]+/g, '-')}-${r.from}-to-${r.to}.xlsx` };
  }

  async pdfFile(idOrLocation: string, q: { from?: string; to?: string }, user: SessionUser) {
    const r = await this.build(idOrLocation, q, user); const e = (x: unknown) => String(x ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    const m = (n: number) => (n ? n.toLocaleString('en-PH', { minimumFractionDigits: 2 }) : '');
    const body = r.lines.map((l) => `<tr${l.money ? ' style="background:#f5d0fe"' : ''}><td class="c">${l.voucher}</td><td class="c">${l.date.slice(5, 7)}/${l.date.slice(8)}/${l.date.slice(2, 4)}</td><td>${e(l.reference)}</td><td>${e(l.remarks)}</td><td>${e(l.name)}</td><td class="c">${e(l.code)}</td><td>${e(l.title)}</td><td class="n">${m(l.debit)}</td><td class="n">${m(l.credit)}</td></tr>`).join('');
    const html = `<html><head><meta charset="utf-8"><style>body{font-family:Arial,Helvetica,sans-serif;font-size:9px;color:#111}h1{font-size:14px;margin:0 0 2px}table{border-collapse:collapse;width:100%;margin-top:6px}th{background:#fbcfe8;border:1px solid #888;padding:3px 4px;text-align:left;font-size:9px}td{border-bottom:1px solid #ddd;padding:2px 4px;vertical-align:top}td.c{text-align:center}td.n{text-align:right;white-space:nowrap}tr.t td{font-weight:bold;border-top:2px solid #333}</style></head><body><h1>${e(r.fund.name)} · cash fund ledger</h1><div>${e(r.from)} to ${e(r.to)} · opening ₱${m(Number(r.openingBalance)) || '0.00'} · balance now ₱${m(Number(r.balance)) || '0.00'}</div><table><thead><tr><th>Voucher</th><th>Date</th><th>Reference</th><th>Remarks</th><th>Name</th><th>Code</th><th>Account Title</th><th>Php Debit</th><th>Php Credit</th></tr></thead><tbody>${body}<tr class="t"><td colspan="7" style="text-align:right">TOTAL</td><td class="n">${m(r.totals.debit)}</td><td class="n">${m(r.totals.credit)}</td></tr></tbody></table></body></html>`;
    const out = await this.pdf.render(html, { landscape: true });
    return { buffer: out.buffer, contentType: out.contentType, fileName: `CashFund-${r.fund.name.replace(/[^A-Za-z0-9]+/g, '-')}-${r.from}-to-${r.to}.${out.ext}` };
  }
}
