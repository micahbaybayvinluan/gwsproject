import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { SequenceService } from '../common/sequence.service';
import { AuditService } from '../common/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CashFundService } from '../cashfund/cashfund.service';
import { dateStr, toDateOnly, todayManila } from '../common/manila';
import { D } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { CHECKLIST, ItemAnswer, validateAnswers } from './checklist';

export interface InspectionInput { locationId: string; inspectionDate?: string; staffOnDutyEmployeeId?: string | null; staffOnDutyName?: string | null; items: ItemAnswer[]; comments?: string | null }

/**
 * Store Inspection Report (owner request 2026-09-26): the Field Auditor fills the checklist in the store (saved as a draft while
 * inspecting), counts the cash fund, and submits it to HR; Admin/Owner and the Head Auditor are notified; the staff on duty
 * acknowledges it in the app (replacing the paper signature); HR marks it reviewed.
 */
@Injectable()
export class InspectionsService {
  constructor(private prisma: PrismaService, private seq: SequenceService, private audit: AuditService, private notify: NotificationsService, private cashFund: CashFundService) {}

  checklist() { return CHECKLIST; }

  private async withNames<T extends { inspectorId: string; staffOnDutyEmployeeId: string | null; staffAcknowledgedBy: string | null; hrReviewedBy: string | null }>(rows: T[]) {
    const ids = [...new Set(rows.flatMap((r) => [r.inspectorId, r.staffAcknowledgedBy, r.hrReviewedBy]).filter((x): x is string => !!x))];
    const users = await this.prisma.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, idNumber: true } });
    const emps = await this.prisma.db.employee.findMany({ where: { id: { in: rows.map((r) => r.staffOnDutyEmployeeId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true, userId: true } });
    const n = (id: string | null) => users.find((u) => u.id === id)?.fullName ?? null;
    return rows.map((r) => ({ ...r, inspectorName: n(r.inspectorId), inspectorIdNumber: users.find((u) => u.id === r.inspectorId)?.idNumber ?? null, staffOnDuty: emps.find((e) => e.id === r.staffOnDutyEmployeeId) ?? null, staffAcknowledgedByName: n(r.staffAcknowledgedBy), hrReviewedByName: n(r.hrReviewedBy) }));
  }
  private canSeeAll(u: SessionUser) { return u.permissions.has('inspection.view') || u.permissions.has('inspection.review'); }
  private async myEmployeeId(u: SessionUser) { return (await this.prisma.db.employee.findUnique({ where: { userId: u.id }, select: { id: true } }))?.id ?? null; }

  async list(user: SessionUser, q: { locationId?: string; status?: string }) {
    const where: Prisma.StoreInspectionWhereInput = { locationId: q.locationId || undefined, status: q.status || undefined };
    if (!this.canSeeAll(user)) { const emp = await this.myEmployeeId(user); where.OR = [{ inspectorId: user.id }, ...(emp ? [{ staffOnDutyEmployeeId: emp }] : [])]; }
    const rows = await this.prisma.db.storeInspection.findMany({ where, include: { location: { select: { name: true, shortCode: true } } }, orderBy: [{ inspectionDate: 'desc' }, { createdAt: 'desc' }], take: 300 });
    return (await this.withNames(rows)).map((r) => ({ ...r, nonCompliant: CHECKLIST.filter((c) => (r.items as unknown as ItemAnswer[]).find((i) => i.key === c.key)?.status === 'NO').length }));
  }
  async get(id: string, user: SessionUser) {
    const r = await this.prisma.db.storeInspection.findUnique({ where: { id }, include: { location: { select: { id: true, name: true, shortCode: true } } } });
    if (!r) throw new NotFoundException();
    if (!this.canSeeAll(user) && r.inspectorId !== user.id && r.staffOnDutyEmployeeId !== (await this.myEmployeeId(user))) throw new ForbiddenException();
    const fund = await this.prisma.db.cashFund.findUnique({ where: { locationId: r.locationId }, select: { balance: true, imprestAmount: true } });
    return { ...(await this.withNames([r]))[0], cashFund: fund, checklist: CHECKLIST };
  }

  async create(input: InspectionInput, user: SessionUser) {
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: input.locationId } });
    const r = await this.prisma.db.$transaction(async (tx) => tx.storeInspection.create({ data: { controlNo: await this.seq.form(tx, 'SI', loc.id), locationId: loc.id, inspectionDate: input.inspectionDate ? toDateOnly(input.inspectionDate) : todayManila(), inspectorId: user.id, staffOnDutyEmployeeId: input.staffOnDutyEmployeeId ?? null, staffOnDutyName: input.staffOnDutyName ?? null, items: this.clean(input.items) as unknown as Prisma.InputJsonValue, comments: input.comments ?? null, cashFundCounted: this.fundAmount(input.items) } }));
    await this.audit.log({ action: 'CREATE', entityType: 'StoreInspection', entityId: r.id, after: r });
    return this.get(r.id, user);
  }
  async update(id: string, input: Partial<InspectionInput>, user: SessionUser) {
    const r = await this.prisma.db.storeInspection.findUniqueOrThrow({ where: { id } });
    if (r.inspectorId !== user.id) throw new ForbiddenException('Only the inspector can change this report');
    if (r.status !== 'DRAFT') throw new BadRequestException('A submitted report can no longer be changed');
    await this.prisma.db.storeInspection.update({ where: { id }, data: { inspectionDate: input.inspectionDate ? toDateOnly(input.inspectionDate) : undefined, staffOnDutyEmployeeId: input.staffOnDutyEmployeeId === undefined ? undefined : input.staffOnDutyEmployeeId, staffOnDutyName: input.staffOnDutyName === undefined ? undefined : input.staffOnDutyName, items: input.items ? (this.clean(input.items) as unknown as Prisma.InputJsonValue) : undefined, cashFundCounted: input.items ? this.fundAmount(input.items) : undefined, comments: input.comments === undefined ? undefined : input.comments } });
    return this.get(id, user);
  }
  private clean(items: ItemAnswer[]) { const keys = new Set(CHECKLIST.map((c) => c.key)); return items.filter((i) => keys.has(i.key)).map((i) => ({ key: i.key, status: i.status ?? null, date: i.date || null, amount: i.amount ?? null, reason: i.reason || null })); }
  private fundAmount(items: ItemAnswer[]) { const a = items.find((i) => i.key === 'cash_fund')?.amount; return a == null ? null : D(a).toFixed(2); }

  /** Submit: every item answered; the cash fund count is recorded against the system balance; HR, Admin and Head Auditor notified. */
  async submit(id: string, user: SessionUser) {
    const r = await this.prisma.db.storeInspection.findUniqueOrThrow({ where: { id }, include: { location: true } });
    if (r.inspectorId !== user.id) throw new ForbiddenException('Only the inspector can submit this report');
    if (r.status !== 'DRAFT') throw new BadRequestException('Already submitted');
    const items = r.items as unknown as ItemAnswer[];
    const { missing, issues } = validateAnswers(items, true);
    if (missing.length) throw new BadRequestException(`Answer every item before submitting: ${missing.slice(0, 5).join('; ')}${missing.length > 5 ? '…' : ''}`);
    if (!r.staffOnDutyEmployeeId && !r.staffOnDutyName) throw new BadRequestException('Name the staff on duty');
    const fundItem = items.find((i) => i.key === 'cash_fund');
    const fund = await this.prisma.db.cashFund.findUnique({ where: { locationId: r.locationId } });
    await this.prisma.db.$transaction(async (tx) => {
      if (fund && fundItem?.amount != null) {
        const variance = D(fundItem.amount).minus(fund.balance);
        if (!variance.isZero() && !fundItem.reason) throw new BadRequestException(`Cash fund: counted ₱${D(fundItem.amount).toFixed(2)} but the system shows ₱${D(fund.balance).toFixed(2)}; enter the reason for lacking`);
        await this.cashFund.check(r.locationId, { countedAmount: fundItem.amount, reason: fundItem.reason ?? undefined, inspectionId: r.id }, user, tx);
      }
      await tx.storeInspection.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date(), cashFundSystem: fund?.balance ?? null } });
    });
    const issueText = issues.length ? `Not complied: ${issues.map((i) => `${i.no}. ${i.group ? `${i.group} – ` : ''}${i.label}`).join('; ')}` : 'All items complied';
    await this.notify.toRoles(['HR_STAFF', 'ADMIN', 'HEAD_AUDITOR'], { type: 'STORE_INSPECTION', title: `Store inspection ${r.controlNo} — ${r.location.name} (${dateStr(r.inspectionDate)}) by ${user.fullName}`, body: issueText, link: `/inspections/${id}` });
    if (r.staffOnDutyEmployeeId) { const e = await this.prisma.db.employee.findUnique({ where: { id: r.staffOnDutyEmployeeId } }); if (e?.userId) await this.notify.toUsers([e.userId], { type: 'STORE_INSPECTION_ACK', title: `Store inspection ${r.controlNo}: please review and acknowledge`, link: `/inspections/${id}` }); }
    await this.audit.log({ action: 'SUBMIT', entityType: 'StoreInspection', entityId: id, after: { issues: issues.map((i) => i.key) } });
    return this.get(id, user);
  }
  /** The staff on duty acknowledges the report (the in-app equivalent of signing over printed name). */
  async acknowledge(id: string, user: SessionUser) {
    const r = await this.prisma.db.storeInspection.findUniqueOrThrow({ where: { id } });
    if (r.status === 'DRAFT') throw new BadRequestException('Not submitted yet');
    const emp = await this.myEmployeeId(user);
    if (!emp || emp !== r.staffOnDutyEmployeeId) throw new ForbiddenException('Only the staff on duty named in the report can acknowledge it');
    if (!r.staffAcknowledgedAt) await this.prisma.db.storeInspection.update({ where: { id }, data: { staffAcknowledgedAt: new Date(), staffAcknowledgedBy: user.id } });
    await this.audit.log({ action: 'ACKNOWLEDGE', entityType: 'StoreInspection', entityId: id });
    return this.get(id, user);
  }
  /** HR marks the report reviewed, with notes. */
  async review(id: string, notes: string | undefined, user: SessionUser) {
    const r = await this.prisma.db.storeInspection.findUniqueOrThrow({ where: { id } });
    if (r.status === 'DRAFT') throw new BadRequestException('Not submitted yet');
    await this.prisma.db.storeInspection.update({ where: { id }, data: { status: 'REVIEWED', hrReviewedAt: new Date(), hrReviewedBy: user.id, hrNotes: notes ?? null } });
    await this.notify.toUsers([r.inspectorId], { type: 'STORE_INSPECTION_REVIEWED', title: `Store inspection ${r.controlNo} reviewed by HR`, body: notes, link: `/inspections/${id}` });
    await this.audit.log({ action: 'REVIEW', entityType: 'StoreInspection', entityId: id, after: { notes } });
    return this.get(id, user);
  }
}
