import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SequenceService, type FormCode } from '../common/sequence.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

export type DraftKind = 'transfer' | 'receiving' | 'count' | 'inspection';
type Later = { id: string; no: number; draft: boolean; owner: string | null };

/**
 * Unfinished drafts can be deleted (owner request 2026-10-01). The form numbers adjust by themselves: the drafts after the deleted one move down one number
 * (their owners are told), a form that is already submitted keeps its number, and a number that cannot be closed up is reused by the next new form.
 */
@Injectable()
export class DraftsService {
  constructor(private prisma: PrismaService, private seq: SequenceService, private audit: AuditService, private notify: NotificationsService) {}

  private can(user: SessionUser, ownerIds: (string | null | undefined)[], extraRoles: string[] = []) {
    return user.roleKey === 'ADMIN' || extraRoles.includes(user.roleKey) || ownerIds.includes(user.id);
  }

  async remove(kind: DraftKind, id: string, user: SessionUser) {
    // the permission is checked per kind below; the numbering of a branch's forms is read across all of its documents
    return requestContext.runSystem(() => this.removeAs(kind, id, user));
  }

  private async removeAs(kind: DraftKind, id: string, user: SessionUser) {
    const moved: { id: string; owner: string | null; from: string; to: string; label: string }[] = [];
    let label = ''; let before: unknown;
    await this.prisma.db.$transaction(async (tx) => {
      const run = async (form: FormCode, locationId: string, no: string, later: Later[], rename: (id: string, newNo: string) => Promise<void>, what: string) => {
        const br = await this.seq.shortCode(tx, locationId);
        const res = await this.seq.closeGap(tx, form, br, SequenceService.numberOf(no), later, rename);
        for (const m of res) moved.push({ ...m, owner: later.find((l) => l.id === m.id)?.owner ?? null, label: what });
      };
      if (kind === 'transfer') {
        const d = await tx.transferDoc.findUnique({ where: { id }, include: { lines: true } });
        if (!d) throw new NotFoundException();
        if (d.status !== 'DRAFT') throw new BadRequestException('Only an unsent draft can be deleted. A sent transfer is cancelled (void) instead.');
        if (d.transferType === 'ECOMMERCE') throw new BadRequestException('An e-commerce pull-out is cancelled on the E-commerce page');
        if (!this.can(user, [d.preparedBy, d.createdBy], ['WAREHOUSE_IN_CHARGE'])) throw new ForbiddenException('Only the person who prepared this draft, the Warehouse In-Charge or the Owner can delete it');
        before = d; label = `${d.controlNo}`;
        await tx.transferLine.deleteMany({ where: { docId: id } }); await tx.attachment.deleteMany({ where: { documentType: 'TransferDoc', documentId: id } }); await tx.transferDoc.delete({ where: { id } });
        const brFrom = await this.seq.shortCode(tx, d.fromLocationId);
        const po = await tx.transferDoc.findMany({ where: { fromLocationId: d.fromLocationId, controlNo: { startsWith: `${brFrom}-PO-` } }, select: { id: true, controlNo: true, status: true, preparedBy: true } });
        await run('PO', d.fromLocationId, d.controlNo, po.map((x) => ({ id: x.id, no: SequenceService.numberOf(x.controlNo), draft: x.status === 'DRAFT', owner: x.preparedBy })), async (i, n) => { await tx.transferDoc.update({ where: { id: i }, data: { controlNo: n } }); }, 'Pull-Out');
        if (d.transferInNo) {
          const brTo = await this.seq.shortCode(tx, d.toLocationId);
          const ti = await tx.transferDoc.findMany({ where: { transferInNo: { startsWith: `${brTo}-TI-` } }, select: { id: true, transferInNo: true, status: true, preparedBy: true } });
          await run('TI', d.toLocationId, d.transferInNo, ti.map((x) => ({ id: x.id, no: SequenceService.numberOf(x.transferInNo!), draft: x.status === 'DRAFT', owner: x.preparedBy })), async (i, n) => { await tx.transferDoc.update({ where: { id: i }, data: { transferInNo: n } }); }, 'Transfer-In');
        }
      } else if (kind === 'receiving') {
        const d = await tx.receivingDoc.findUnique({ where: { id }, include: { lines: true } });
        if (!d) throw new NotFoundException();
        if (d.status !== 'DRAFT') throw new BadRequestException('Only an unsubmitted draft can be deleted');
        if (!this.can(user, [d.preparedBy, d.createdBy], ['WAREHOUSE_IN_CHARGE'])) throw new ForbiddenException('Only the person who prepared this draft, the Warehouse In-Charge or the Owner can delete it');
        before = d; label = d.controlNo;
        await tx.receivingLine.deleteMany({ where: { docId: id } }); await tx.attachment.deleteMany({ where: { documentType: 'ReceivingDoc', documentId: id } }); await tx.receivingDoc.delete({ where: { id } });
        const br = await this.seq.shortCode(tx, d.locationId);
        const rows = await tx.receivingDoc.findMany({ where: { locationId: d.locationId, controlNo: { startsWith: `${br}-RC-` } }, select: { id: true, controlNo: true, status: true, preparedBy: true } });
        await run('RC', d.locationId, d.controlNo, rows.map((x) => ({ id: x.id, no: SequenceService.numberOf(x.controlNo), draft: x.status === 'DRAFT', owner: x.preparedBy })), async (i, n) => { await tx.receivingDoc.update({ where: { id: i }, data: { controlNo: n } }); }, "Supplier's Form");
      } else if (kind === 'count') {
        const d = await tx.countDoc.findUnique({ where: { id }, include: { lines: true } });
        if (!d) throw new NotFoundException();
        if (d.status !== 'DRAFT') throw new BadRequestException('A submitted count sheet is locked; ask for a revision instead');
        if (!this.can(user, [d.countedBy, d.createdBy], ['HEAD_AUDITOR'])) throw new ForbiddenException('Only the person who started this count sheet, the Head Auditor or the Owner can delete it');
        before = d; label = d.controlNo;
        await tx.countLine.deleteMany({ where: { docId: id } }); await tx.attachment.deleteMany({ where: { documentType: 'CountDoc', documentId: id } }); await tx.countDoc.delete({ where: { id } });
        const br = await this.seq.shortCode(tx, d.locationId);
        const rows = await tx.countDoc.findMany({ where: { locationId: d.locationId, controlNo: { startsWith: `${br}-IC-` } }, select: { id: true, controlNo: true, status: true, countedBy: true } });
        await run('IC', d.locationId, d.controlNo, rows.map((x) => ({ id: x.id, no: SequenceService.numberOf(x.controlNo), draft: x.status === 'DRAFT', owner: x.countedBy })), async (i, n) => { await tx.countDoc.update({ where: { id: i }, data: { controlNo: n } }); }, 'Count sheet');
      } else {
        const d = await tx.storeInspection.findUnique({ where: { id } });
        if (!d) throw new NotFoundException();
        if (d.status !== 'DRAFT') throw new BadRequestException('A submitted inspection report cannot be deleted');
        if (!this.can(user, [d.inspectorId], ['HEAD_AUDITOR'])) throw new ForbiddenException('Only the inspector, the Head Auditor or the Owner can delete this draft');
        before = d; label = d.controlNo;
        await tx.attachment.deleteMany({ where: { documentType: 'StoreInspection', documentId: id } }); await tx.storeInspection.delete({ where: { id } });
        const br = await this.seq.shortCode(tx, d.locationId);
        const rows = await tx.storeInspection.findMany({ where: { locationId: d.locationId, controlNo: { startsWith: `${br}-SI-` } }, select: { id: true, controlNo: true, status: true, inspectorId: true } });
        await run('SI', d.locationId, d.controlNo, rows.map((x) => ({ id: x.id, no: SequenceService.numberOf(x.controlNo), draft: x.status === 'DRAFT', owner: x.inspectorId })), async (i, n) => { await tx.storeInspection.update({ where: { id: i }, data: { controlNo: n } }); }, 'Inspection report');
      }
    });
    await this.audit.log({ action: 'DRAFT_DELETE', entityType: { transfer: 'TransferDoc', receiving: 'ReceivingDoc', count: 'CountDoc', inspection: 'StoreInspection' }[kind], entityId: id, before: before as Prisma.InputJsonValue, after: { deletedNo: label, renumbered: moved.map((m) => `${m.from} → ${m.to}`) } as Prisma.InputJsonValue });
    for (const m of moved) {
      await this.audit.log({ action: 'RENUMBER', entityType: kind, entityId: m.id, after: { from: m.from, to: m.to, because: `draft ${label} was deleted` } });
      if (m.owner && m.owner !== user.id) await this.notify.toUsers([m.owner], { type: 'FORM_RENUMBERED', title: `Your draft ${m.from} is now ${m.to} (${m.label}): the draft ${label} before it was deleted`, body: 'Print the draft again if you already printed it.' });
    }
    return { deleted: label, renumbered: moved.map((m) => ({ from: m.from, to: m.to })) };
  }
}
