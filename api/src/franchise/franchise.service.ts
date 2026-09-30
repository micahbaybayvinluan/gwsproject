import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FranchiseArService } from './franchise-ar.service';
import { MasterService } from '../master/master.service';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import { D } from '../common/money';
import { dateStr, todayManila, toDateOnly } from '../common/manila';

const ZERO = new Prisma.Decimal(0);
const sum = (xs: (Prisma.Decimal | null | undefined)[]) => xs.reduce<Prisma.Decimal>((t, x) => t.plus(x ?? 0), ZERO);

/**
 * A franchise runs its own staff and books (owner requests 2026-09-26), separate from GWS:
 * - the owner decides whether the franchise associate may receive incoming transfers (the owner is then only notified);
 * - the owner pays their associates (recorded as a franchise salary expense; company HR has no access) and charges them;
 * - the owner sees their own income statement and balance sheet built from the franchise's records only.
 */
@Injectable()
export class FranchiseService {
  constructor(private prisma: PrismaService, private audit: AuditService, private notify: NotificationsService, private master: MasterService, private ar: FranchiseArService) {}

  private async myLocation(user: SessionUser) {
    const id = user.locationIds[0];
    if (!id) throw new BadRequestException('This account is not assigned to a franchise');
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id } });
    if (loc.type !== 'FRANCHISE') throw new ForbiddenException('For franchise accounts only');
    return loc;
  }
  private owner(user: SessionUser) { if (user.roleKey !== 'FRANCHISE_OWNER') throw new ForbiddenException('Only the franchise owner can do this'); }

  async settings(user: SessionUser) { const loc = await this.myLocation(user); return { locationId: loc.id, name: loc.name, associateReceives: loc.franchiseAssociateReceives }; }
  async setSettings(user: SessionUser, input: { associateReceives: boolean }) {
    this.owner(user); const loc = await this.myLocation(user);
    await this.prisma.db.location.update({ where: { id: loc.id }, data: { franchiseAssociateReceives: input.associateReceives } });
    await this.audit.log({ action: 'UPDATE', entityType: 'Location', entityId: loc.id, before: { franchiseAssociateReceives: loc.franchiseAssociateReceives }, after: input });
    const staff = await this.staff(user);
    await this.notify.toUsers(staff.map((s) => s.id), { type: 'FRANCHISE_SETTING', title: input.associateReceives ? 'You may now receive incoming transfers for the franchise' : 'Incoming transfers are now received by the franchise owner', link: '/transfers' });
    return this.settings(user);
  }

  /** The franchise's associates (accounts assigned to this franchise). */
  async staff(user: SessionUser) {
    const loc = await this.myLocation(user);
    return this.prisma.db.user.findMany({ where: { active: true, role: { key: 'FRANCHISE_SALES_ASSOCIATE' }, assignments: { some: { locationId: loc.id } } }, select: { id: true, fullName: true, username: true, idNumber: true }, orderBy: { fullName: 'asc' } });
  }
  private async assertStaff(user: SessionUser, userId: string) { const staff = await this.staff(user); const s = staff.find((x) => x.id === userId); if (!s) throw new BadRequestException('That person is not one of your franchise associates'); return s; }

  // ── Charges to franchise associates ──
  async charges(user: SessionUser) {
    const loc = await this.myLocation(user);
    const rows = await this.prisma.db.franchiseCharge.findMany({ where: { locationId: loc.id, voidedAt: null, ...(user.roleKey === 'FRANCHISE_OWNER' ? {} : { userId: user.id }) }, orderBy: { createdAt: 'desc' } });
    const names = await this.names(rows.map((r) => r.userId));
    return rows.map((r) => ({ ...r, staff: names.get(r.userId) ?? '', deducted: !!r.salaryId }));
  }
  async createCharge(user: SessionUser, input: { userIds: string[]; kind: string; reason: string; amount: number; sourceChargeFormId?: string }) {
    this.owner(user); const loc = await this.myLocation(user);
    if (!input.userIds.length) throw new BadRequestException('Choose who is charged');
    if (!(input.amount > 0)) throw new BadRequestException('The amount must be more than zero');
    for (const id of input.userIds) await this.assertStaff(user, id);
    // split equally; the last person takes the centavo remainder
    const each = D(input.amount).div(input.userIds.length).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    const rows = [];
    for (const [i, userId] of input.userIds.entries()) {
      const amount = i === input.userIds.length - 1 ? D(input.amount).minus(each.mul(input.userIds.length - 1)) : each;
      rows.push(await this.prisma.db.franchiseCharge.create({ data: { locationId: loc.id, userId, kind: input.kind, reason: input.reason, amount: amount.toFixed(2), sourceChargeFormId: input.sourceChargeFormId ?? null, createdBy: user.id } }));
    }
    await this.audit.log({ action: 'CREATE', entityType: 'FranchiseCharge', entityId: rows[0].id, after: { ...input, locationId: loc.id } });
    await this.notify.toUsers(input.userIds, { type: 'CHARGE_TO_YOU', title: `You were charged by ${loc.name}: ${input.reason}`, body: 'Open "My Pay & Charges" to see it and acknowledge.', link: '/my-hr' });
    return rows;
  }
  /** Company charge form at this franchise (e.g. an inventory discrepancy) assigned by the owner to their associates. */
  async assignChargeForm(user: SessionUser, chargeFormId: string, userIds: string[]) {
    this.owner(user); const loc = await this.myLocation(user);
    const cf = await this.prisma.db.chargeForm.findUnique({ where: { id: chargeFormId } });
    if (!cf || cf.locationId !== loc.id) throw new NotFoundException();
    if (cf.finalizedByHrAt) throw new BadRequestException('This charge form is already assigned');
    const rows = await this.createCharge(user, { userIds, kind: cf.kind, reason: `${cf.controlNo}: ${cf.reason ?? 'charge form'}`, amount: Number(cf.totalAmount), sourceChargeFormId: cf.id });
    await this.prisma.db.chargeForm.update({ where: { id: cf.id }, data: { finalizedByHrAt: new Date(), finalizedBy: user.id } });
    return rows;
  }
  async chargeFormsToAssign(user: SessionUser) {
    this.owner(user); const loc = await this.myLocation(user);
    return this.prisma.db.chargeForm.findMany({ where: { locationId: loc.id, finalizedByHrAt: null }, select: { id: true, controlNo: true, kind: true, reason: true, totalAmount: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
  }
  async acknowledgeCharge(user: SessionUser, id: string) {
    const c = await this.prisma.db.franchiseCharge.findUnique({ where: { id } });
    if (!c || c.userId !== user.id) throw new ForbiddenException('Only the person charged can acknowledge');
    return this.prisma.db.franchiseCharge.update({ where: { id }, data: { acknowledgedAt: c.acknowledgedAt ?? new Date() } });
  }

  // ── Franchise salaries ──
  async salaries(user: SessionUser) {
    const loc = await this.myLocation(user);
    const rows = await this.prisma.db.franchiseSalary.findMany({ where: { locationId: loc.id, voidedAt: null, ...(user.roleKey === 'FRANCHISE_OWNER' ? {} : { userId: user.id }) }, orderBy: [{ periodTo: 'desc' }, { createdAt: 'desc' }] });
    const names = await this.names(rows.map((r) => r.userId));
    return rows.map((r) => ({ ...r, staff: names.get(r.userId) ?? '', periodFrom: dateStr(r.periodFrom), periodTo: dateStr(r.periodTo) }));
  }
  /** Owner records a salary; open charges can be deducted; the gross pay becomes a franchise "Salaries" expense (own books only). */
  async createSalary(user: SessionUser, input: { userId: string; periodFrom: string; periodTo: string; basic: number; allowances?: number; otherDeductions?: number; deductCharges?: boolean; notes?: string }) {
    this.owner(user); const loc = await this.myLocation(user);
    const staff = await this.assertStaff(user, input.userId);
    const from = toDateOnly(input.periodFrom), to = toDateOnly(input.periodTo);
    if (to < from) throw new BadRequestException('The period ends before it starts');
    if (input.basic < 0 || (input.allowances ?? 0) < 0 || (input.otherDeductions ?? 0) < 0) throw new BadRequestException('Pay amounts cannot be negative');
    const open = input.deductCharges ? await this.prisma.db.franchiseCharge.findMany({ where: { locationId: loc.id, userId: input.userId, voidedAt: null, salaryId: null } }) : [];
    const gross = D(input.basic).plus(input.allowances ?? 0);
    const charges = sum(open.map((c) => c.amount));
    // net pay may be negative when charges exceed pay (the balance is carried by the franchise owner)
    const net = gross.minus(input.otherDeductions ?? 0).minus(charges);
    const s = await this.prisma.db.$transaction(async (tx) => {
      const exp = await tx.franchiseExpense.create({ data: { locationId: loc.id, docDate: to, category: 'Salaries', payee: staff.fullName, amount: gross.toFixed(2), notes: `Salary ${input.periodFrom} to ${input.periodTo}`, createdBy: user.id } });
      const sal = await tx.franchiseSalary.create({ data: { locationId: loc.id, userId: input.userId, periodFrom: from, periodTo: to, basic: D(input.basic).toFixed(2), allowances: D(input.allowances ?? 0).toFixed(2), otherDeductions: D(input.otherDeductions ?? 0).toFixed(2), chargesDeducted: charges.toFixed(2), netPay: net.toFixed(2), notes: input.notes, expenseId: exp.id, createdBy: user.id } });
      if (open.length) await tx.franchiseCharge.updateMany({ where: { id: { in: open.map((c) => c.id) } }, data: { salaryId: sal.id } });
      return sal;
    });
    await this.audit.log({ action: 'CREATE', entityType: 'FranchiseSalary', entityId: s.id, after: s });
    await this.notify.toUsers([input.userId], { type: 'FRANCHISE_SALARY', title: `Your salary for ${input.periodFrom} to ${input.periodTo} was recorded: net ₱${net.toFixed(2)}`, link: '/my-hr' });
    return s;
  }

  /** The signed-in franchise associate's own pay and charges. */
  async mine(user: SessionUser) { return { salaries: await this.salaries({ ...user, roleKey: 'FRANCHISE_SALES_ASSOCIATE' }), charges: await this.charges({ ...user, roleKey: 'FRANCHISE_SALES_ASSOCIATE' }) }; }

  // ── Franchise statements (owner only) ──
  async incomeStatement(user: SessionUser, from: string, to: string) {
    this.owner(user); const loc = await this.myLocation(user);
    const f = toDateOnly(from), t = toDateOnly(to);
    const lines = await this.prisma.db.salesLine.findMany({ where: { doc: { locationId: loc.id, voidedAt: null, docDate: { gte: f, lte: t } } }, include: { doc: { select: { docDate: true } } } });
    let sales = ZERO, cogs = ZERO;
    for (const l of lines) { sales = sales.plus(l.amount); cogs = cogs.plus(D((await this.master.priceFor(l.productId, 'FRANCHISE', l.doc.docDate)) ?? 0).mul(l.qty)); }
    const fees = await this.prisma.db.salesDoc.aggregate({ where: { locationId: loc.id, voidedAt: null, docDate: { gte: f, lte: t } }, _sum: { deliveryFee: true, shippingFee: true } });
    const exp = await this.prisma.db.franchiseExpense.groupBy({ by: ['category'], where: { locationId: loc.id, voidedAt: null, docDate: { gte: f, lte: t } }, _sum: { amount: true } });
    const recovered = sum((await this.prisma.db.franchiseSalary.findMany({ where: { locationId: loc.id, voidedAt: null, periodTo: { gte: f, lte: t } }, select: { chargesDeducted: true } })).map((x) => x.chargesDeducted));
    const feeTotal = D(fees._sum.deliveryFee).plus(fees._sum.shippingFee ?? 0);
    const revenue = sales.plus(feeTotal);
    const expenses = exp.map((e) => ({ category: e.category, amount: e._sum.amount ?? ZERO }));
    const totalExpenses = sum(expenses.map((e) => e.amount));
    const netIncome = revenue.minus(cogs).minus(totalExpenses).plus(recovered);
    return { franchise: loc.name, from, to, revenue: { productSales: sales, fees: feeTotal, total: revenue }, costOfGoodsAtFranchiseCost: cogs, grossProfit: revenue.minus(cogs), expenses, totalExpenses, otherIncome: { staffChargesRecovered: recovered }, netIncome };
  }

  /**
   * Management balance sheet from the franchise's own records: cash = customer receipts − expenses paid − net salaries − payments to
   * GWS; inventory at franchise cost; receivables from the franchise's customers; payable to GWS; owner's equity balances it.
   */
  async balanceSheet(user: SessionUser, asOf: string) {
    this.owner(user); const loc = await this.myLocation(user);
    const d = toDateOnly(asOf || dateStr(todayManila()));
    const salesDocs = await this.prisma.db.salesDoc.findMany({ where: { locationId: loc.id, voidedAt: null, docDate: { lte: d } }, select: { grandTotal: true, amountPaid: true, paymentMode: true } });
    const receipts = sum(salesDocs.map((s) => s.amountPaid));
    const receivables = sum(salesDocs.map((s) => D(s.grandTotal).minus(s.amountPaid)));
    const expenses = await this.prisma.db.franchiseExpense.findMany({ where: { locationId: loc.id, voidedAt: null, docDate: { lte: d } }, select: { id: true, amount: true, category: true } });
    const salaries = await this.prisma.db.franchiseSalary.findMany({ where: { locationId: loc.id, voidedAt: null, periodTo: { lte: d } }, select: { expenseId: true, netPay: true } });
    const salaryExpenseIds = new Set(salaries.map((s) => s.expenseId));
    const cashExpenses = sum(expenses.filter((e) => !salaryExpenseIds.has(e.id)).map((e) => e.amount)).plus(sum(salaries.map((s) => s.netPay)));
    const cust = await this.prisma.db.customer.findFirst({ where: { locationId: loc.id, type: 'FRANCHISE' } });
    const paidToGws = cust ? sum((await this.prisma.db.payment.findMany({ where: { customerId: cust.id, voidedAt: null, status: 'POSTED', businessDate: { lte: d } }, select: { amount: true } })).map((p) => p.amount)) : ZERO;
    // GWS invoices to this franchise live at GWS locations: read outside the franchise's branch scope
    const owedDocs = cust ? await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findMany({ where: { customerId: cust.id, voidedAt: null, docDate: { lte: d } }, select: { grandTotal: true, amountPaid: true } })) : [];
    const arNow = await this.ar.summary(loc.id);
    const payableToGws = sum(owedDocs.map((x) => D(x.grandTotal).minus(x.amountPaid))).plus(arNow.total);
    const stock = await this.prisma.db.stockBalance.groupBy({ by: ['productId'], where: { locationId: loc.id, qty: { gt: 0 } }, _sum: { qty: true } });
    let inventory = ZERO; for (const s of stock) inventory = inventory.plus(D((await this.master.priceFor(s.productId, 'FRANCHISE', d)) ?? 0).mul(s._sum.qty ?? 0));
    const cash = receipts.minus(cashExpenses).minus(paidToGws);
    const assets = [{ account: 'Cash (sales receipts less expenses, salaries and payments to GWS)', amount: cash }, { account: 'Accounts receivable (franchise customers)', amount: receivables }, { account: 'Inventory at franchise cost', amount: inventory }];
    const totalAssets = sum(assets.map((a) => a.amount));
    const liabilities = [{ account: 'Payable to GWS (unpaid franchise invoices, penalty and interest)', amount: payableToGws }];
    const totalLiabilities = sum(liabilities.map((l) => l.amount));
    const equity = [{ account: "Owner's equity (capital and retained earnings)", amount: totalAssets.minus(totalLiabilities) }];
    return { franchise: loc.name, asOf: dateStr(d), assets, totalAssets, liabilities, totalLiabilities, equity, totalEquity: totalAssets.minus(totalLiabilities), note: 'Built from the franchise records in GWS-ERP. Owner capital put in outside the system is part of equity.' };
  }

  private async names(ids: string[]) { const us = await this.prisma.db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } }); return new Map(us.map((u) => [u.id, u.fullName])); }
}
