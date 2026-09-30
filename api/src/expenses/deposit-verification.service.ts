import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import { dateStr } from '../common/manila';

/**
 * Cash deposits need their bank deposit slip (owner request 2026-09-30). The branch attaches the slip when it records the deposit; the
 * Audit Associate checks it against the amount, bank and date; then the Accounting Associate checks it too. A deposit rejected by either
 * goes back to the branch with the reason, and the branch fixes it (new slip or correction) and sends it again.
 */
@Injectable()
export class DepositVerificationService implements OnModuleInit {
  constructor(private prisma: PrismaService, private approvals: ApprovalsService, private notify: NotificationsService, private audit: AuditService) {}

  onModuleInit() {
    this.approvals.register('CASH_DEPOSIT_AUDIT', (r, outcome, actor) => this.onDecision(r.documentId, 'AUDIT', outcome, actor), 'CashDeposit');
    this.approvals.register('CASH_DEPOSIT_ACCOUNTING', (r, outcome, actor) => this.onDecision(r.documentId, 'ACCOUNTING', outcome, actor), 'CashDeposit');
  }

  private async summaryOf(depositId: string, step: string) {
    const d = await this.prisma.db.cashDeposit.findUniqueOrThrow({ where: { id: depositId }, include: { bankAccount: { select: { title: true } } } });
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: d.locationId }, select: { name: true } });
    const by = d.createdBy ? await this.prisma.db.user.findUnique({ where: { id: d.createdBy }, select: { fullName: true } }) : null;
    return { d, loc, by, summary: { controlNo: `Deposit of ${dateStr(d.businessDate)} sales`, locationId: d.locationId, locationName: `${loc.name} · ${d.bankAccount.title}`, total: d.amount.toFixed(2), businessDate: dateStr(d.businessDate), depositedAt: dateStr(d.depositedAt), bank: d.bankAccount.title, enteredBy: by?.fullName ?? '', step } };
  }

  /** The deposit is waiting for the Audit Associate. */
  async requestAudit(depositId: string, requestedBy: string) {
    const { summary } = await this.summaryOf(depositId, 'The Audit Associate checks the deposit slip against the amount, bank and date; then the Accounting Associate checks it');
    const req = await this.approvals.request({ type: 'CASH_DEPOSIT_AUDIT', documentType: 'CashDeposit', documentId: depositId, requestedBy, summary });
    await this.prisma.db.cashDeposit.update({ where: { id: depositId }, data: { status: 'PENDING_AUDIT', approvalRequestId: req.id, rejectedBy: null, rejectedAt: null, rejectReason: null } });
  }

  private async onDecision(depositId: string, stage: 'AUDIT' | 'ACCOUNTING', outcome: 'APPROVED' | 'REJECTED', actor: { id: string; note?: string } | null) {
    await requestContext.runSystem(async () => {
      const d0 = await this.prisma.db.cashDeposit.findUnique({ where: { id: depositId } });
      if (!d0) return;
      if ((stage === 'AUDIT' && d0.status !== 'PENDING_AUDIT') || (stage === 'ACCOUNTING' && d0.status !== 'PENDING_ACCOUNTING')) return;
      const { d, loc, summary } = await this.summaryOf(depositId, '');
      const who = actor ? (await this.prisma.db.user.findUnique({ where: { id: actor.id }, select: { fullName: true } }))?.fullName ?? '' : 'the Owner';
      const link = '/closing';
      if (outcome === 'REJECTED') {
        await this.prisma.db.cashDeposit.update({ where: { id: depositId }, data: { status: 'REJECTED', rejectedBy: actor?.id ?? null, rejectedAt: new Date(), rejectReason: actor?.note ?? 'Not accepted' } });
        const n = { type: 'CASH_DEPOSIT_REJECTED', title: `${loc.name}: deposit of ${dateStr(d.businessDate)} sales (₱${d.amount}) was not accepted by ${who}: ${actor?.note ?? ''}`, body: 'Open Daily Close & Deposit, fix the deposit (attach the right slip) and send it again.', link };
        await this.notify.toLocation(d.locationId, n);
        await this.notify.toRoles(['HEAD_AUDITOR', 'ACCOUNTING_HEAD', 'ADMIN'], { ...n, title: `⚑ ${n.title}` });
        await this.audit.log({ action: 'REJECT', entityType: 'CashDeposit', entityId: depositId, after: { stage, reason: actor?.note }, userId: actor?.id });
        return;
      }
      if (stage === 'AUDIT') {
        await this.prisma.db.cashDeposit.update({ where: { id: depositId }, data: { status: 'PENDING_ACCOUNTING', auditVerifiedBy: actor?.id ?? null, auditVerifiedAt: new Date() } });
        const req = await this.approvals.request({ type: 'CASH_DEPOSIT_ACCOUNTING', documentType: 'CashDeposit', documentId: depositId, requestedBy: d.createdBy ?? actor?.id ?? '', summary: { ...summary, step: `Checked by ${who} (Audit). The Accounting Associate checks the slip and the bank record` } });
        await this.prisma.db.cashDeposit.update({ where: { id: depositId }, data: { approvalRequestId: req.id } });
        await this.notify.toLocation(d.locationId, { type: 'CASH_DEPOSIT_PROGRESS', title: `${loc.name}: deposit of ${dateStr(d.businessDate)} sales checked by the Audit Associate (${who}); Accounting checks it next`, link });
      } else {
        await this.prisma.db.cashDeposit.update({ where: { id: depositId }, data: { status: 'VERIFIED', accountingVerifiedBy: actor?.id ?? null, accountingVerifiedAt: new Date() } });
        await this.notify.toLocation(d.locationId, { type: 'CASH_DEPOSIT_VERIFIED', title: `${loc.name}: deposit of ${dateStr(d.businessDate)} sales (₱${d.amount}) verified by Audit and Accounting`, link });
      }
      await this.audit.log({ action: 'VERIFY', entityType: 'CashDeposit', entityId: depositId, after: { stage }, userId: actor?.id });
    });
  }

  /** The branch fixes a rejected deposit (a new slip, or the same one after correcting) and sends it again. */
  async resubmit(depositId: string, input: { slipAttachmentId?: string | null; note?: string }, user: SessionUser) {
    const d = await this.prisma.db.cashDeposit.findUnique({ where: { id: depositId } });
    if (!d) throw new NotFoundException();
    if (user.locationScoped && !user.locationIds.includes(d.locationId)) throw new ForbiddenException();
    if (d.status !== 'REJECTED') throw new BadRequestException('Only a deposit that was not accepted can be sent again');
    const slip = input.slipAttachmentId ?? d.slipAttachmentId;
    if (!slip) throw new BadRequestException('Attach the bank deposit slip');
    await this.prisma.db.cashDeposit.update({ where: { id: depositId }, data: { slipAttachmentId: slip } });
    await this.requestAudit(depositId, user.id);
    await this.audit.log({ action: 'RESUBMIT', entityType: 'CashDeposit', entityId: depositId, after: { note: input.note } });
    return this.prisma.db.cashDeposit.findUniqueOrThrow({ where: { id: depositId } });
  }

  /** Everything the checker sees in the approval list: the deposit and its slip. */
  async review(depositId: string) {
    return requestContext.runSystem(async () => {
      const { d, loc, by } = await this.summaryOf(depositId, '');
      const slip = d.slipAttachmentId ? await this.prisma.db.attachment.findUnique({ where: { id: d.slipAttachmentId }, select: { id: true, fileName: true, contentType: true } }) : null;
      const audit = d.auditVerifiedBy ? await this.prisma.db.user.findUnique({ where: { id: d.auditVerifiedBy }, select: { fullName: true } }) : null;
      return { id: d.id, branch: loc.name, businessDate: dateStr(d.businessDate), depositedAt: dateStr(d.depositedAt), amount: d.amount, bank: (await this.prisma.db.account.findUnique({ where: { id: d.bankAccountId }, select: { title: true } }))?.title ?? '', enteredBy: by?.fullName ?? null, status: d.status, auditVerifiedBy: audit?.fullName ?? null, slip };
    });
  }
}
