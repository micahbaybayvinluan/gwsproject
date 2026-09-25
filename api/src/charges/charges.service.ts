import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ChargeKind } from '@prisma/client';
import { PrismaService, Tx } from '../common/prisma.service';
import { SequenceService } from '../common/sequence.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { D, ZERO } from '../common/money';
import type { SessionUser } from '../common/request-context';

export interface ChargeLineInput { productId?: string | null; description?: string | null; qty: number; unitCharge: string | number | { toString(): string }; batchCost?: string | number | { toString(): string } | null }
export const KIND_LABEL: Record<ChargeKind, string> = { INVENTORY_DISCREPANCY: 'Inventory discrepancy', EXPIRED: 'Expired items', DAMAGED: 'Damaged / spoiled items', CASH_SHORTAGE: 'Cash shortage', OTHER: 'Other charge' };

/** Split a total into n shares that add up exactly (the last share takes the rounding). */
export function splitEqually(total: string | number, n: number): string[] {
  const t = D(total); const each = t.div(n).toDecimalPlaces(2, 1);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? t.minus(each.mul(n - 1)) : each).toFixed(2));
}

/**
 * Staff charges (owner request 2026-09-26): charge forms are created automatically by the source document — inventory count,
 * expired / damaged write-off charged to staff, cash shortage at daily close, or a manual "other" charge — with the named staff
 * pre-allocated. HR only reviews and clicks Finalize; the charged staff see it and acknowledge in the app; payroll deducts it.
 */
@Injectable()
export class ChargesService {
  constructor(private prisma: PrismaService, private seq: SequenceService, private notify: NotificationsService, private audit: AuditService) {}

  /** Staff of a location (names only, no pay) for choosing who is charged / on duty. */
  async staff(user: SessionUser, locationId?: string) {
    if (locationId && user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    const where = locationId ? { locationId } : user.locationScoped ? { locationId: { in: user.locationIds } } : {};
    return this.prisma.db.employee.findMany({ where: { active: true, ...where }, select: { id: true, employeeNo: true, fullName: true, position: true, locationId: true, location: { select: { name: true } } }, orderBy: { fullName: 'asc' } });
  }

  async assertEmployees(ids: string[]) {
    if (!ids.length) throw new BadRequestException('Choose at least one staff member to charge');
    const found = await this.prisma.db.employee.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, fullName: true } });
    if (found.length !== new Set(ids).size) throw new BadRequestException('Unknown or inactive staff member');
    return found;
  }

  /** Creates the charge form (inside the caller's transaction) and, when staff are named, splits it equally among them. */
  async create(tx: Tx, input: { kind: ChargeKind; locationId: string; sourceType?: string; sourceId?: string; reason?: string; lines: ChargeLineInput[]; employeeIds?: string[]; createdBy?: string | null }) {
    const controlNo = await this.seq.form(tx, 'CF', input.locationId);
    const lines = input.lines.map((l) => ({ productId: l.productId ?? null, description: l.description ?? null, qty: l.qty, unitCharge: D(l.unitCharge.toString()).toFixed(2), batchCost: l.batchCost != null ? D(l.batchCost.toString()).toFixed(2) : null, amount: D(l.unitCharge.toString()).mul(l.qty).toFixed(2) }));
    const total = lines.reduce((t, l) => t.plus(l.amount), ZERO);
    const cf = await tx.chargeForm.create({ data: { controlNo, kind: input.kind, sourceType: input.sourceType, sourceId: input.sourceId, reason: input.reason, locationId: input.locationId, totalAmount: total.toFixed(2), createdBy: input.createdBy ?? null, lines: { create: lines } } });
    const ids = [...new Set(input.employeeIds ?? [])];
    if (ids.length && total.gt(0)) { const shares = splitEqually(total.toFixed(2), ids.length); await tx.chargeFormAllocation.createMany({ data: ids.map((employeeId, i) => ({ chargeFormId: cf.id, employeeId, amount: shares[i] })) }); }
    return cf;
  }

  /** After commit: HR, Head Auditor and Admin get the form to finalize; each charged staff member (if they have an account) is told. */
  async announce(chargeFormId: string) {
    const cf = await this.prisma.db.chargeForm.findUniqueOrThrow({ where: { id: chargeFormId }, include: { location: { select: { name: true } }, allocations: { include: { employee: { select: { userId: true, fullName: true } } } } } });
    const label = KIND_LABEL[cf.kind];
    await this.notify.toRoles(['HR_STAFF', 'HEAD_AUDITOR', 'ADMIN'], { type: 'CHARGE_FORM_READY', title: `${label}: charge form ${cf.controlNo} (${cf.location.name}) ready for HR`, body: cf.allocations.length ? `Charged to ${cf.allocations.map((a) => a.employee.fullName).join(', ')}` : 'Allocate to staff', link: `/charge-forms/${cf.id}` });
    const users = cf.allocations.map((a) => a.employee.userId).filter((u): u is string => !!u);
    if (users.length) await this.notify.toUsers(users, { type: 'CHARGE_TO_YOU', title: `${label}: you were charged (${cf.controlNo})`, body: 'Open "My Pay & Charges" to see the details and acknowledge.', link: '/my-hr' });
  }

  /** The charged employee acknowledges the charge in the app (the Salary Deduction Authorization). */
  async acknowledge(allocationId: string, user: SessionUser) {
    const a = await this.prisma.db.chargeFormAllocation.findUnique({ where: { id: allocationId }, include: { employee: true } });
    if (!a) throw new NotFoundException();
    if (a.employee.userId !== user.id) throw new ForbiddenException('Only the charged staff member can acknowledge');
    if (a.acknowledgedAt) return a;
    const after = await this.prisma.db.chargeFormAllocation.update({ where: { id: allocationId }, data: { acknowledgedAt: new Date(), acknowledgedBy: user.id } });
    await this.audit.log({ action: 'CHARGE_ACKNOWLEDGED', entityType: 'ChargeForm', entityId: a.chargeFormId, after: { allocationId, amount: a.amount } });
    await this.notify.toRoles(['HR_STAFF'], { type: 'CHARGE_ACKNOWLEDGED', title: `${a.employee.fullName} acknowledged a charge`, link: `/charge-forms/${a.chargeFormId}` });
    return after;
  }

  /** "My Pay & Charges": the signed-in person's own employee record, charges, loans/advances and payslips — nobody else's. */
  async mine(user: SessionUser) {
    const e = await this.prisma.db.employee.findUnique({ where: { userId: user.id }, select: { id: true, employeeNo: true, fullName: true, position: true, location: { select: { name: true } } } });
    if (!e) return { employee: null, charges: [], loans: [], payslips: [] };
    const charges = await this.prisma.db.chargeFormAllocation.findMany({ where: { employeeId: e.id }, include: { chargeForm: { select: { id: true, controlNo: true, kind: true, reason: true, totalAmount: true, createdAt: true, finalizedByHrAt: true, payrollDeductionSchedule: true, location: { select: { name: true } }, lines: { select: { qty: true, unitCharge: true, amount: true, description: true, product: { select: { name: true } } } } } } }, orderBy: { chargeForm: { createdAt: 'desc' } } });
    const loans = await this.prisma.db.employeeLoan.findMany({ where: { employeeId: e.id }, orderBy: { createdAt: 'desc' } });
    const payslips = await this.prisma.db.payrollLine.findMany({ where: { employeeId: e.id, run: { status: { in: ['FINALIZED', 'CLOSED'] } } }, include: { run: { select: { periodFrom: true, periodTo: true, status: true } } }, orderBy: { run: { periodTo: 'desc' } }, take: 24 });
    return { employee: e, charges: charges.map((c) => ({ ...c, kindLabel: KIND_LABEL[c.chargeForm.kind], open: D(c.amount).minus(c.deductedToDate).toFixed(2) })), loans, payslips };
  }
}
