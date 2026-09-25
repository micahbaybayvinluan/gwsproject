import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../common/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReceivingService, type ReceivingEditInput } from '../receiving/receiving.service';
import { TransfersService, type TransferEditInput } from '../transfers/transfers.service';
import { requestContext, type SessionUser } from '../common/request-context';
import { describeChanges, type Snap } from './edit-diff';
import { RevisionsService } from '../revisions/revisions.service';

export type EditableKind = 'receiving' | 'transfers';
const DOC_TYPE: Record<EditableKind, 'ReceivingDoc' | 'TransferDoc'> = { receiving: 'ReceivingDoc', transfers: 'TransferDoc' };
const LABEL: Record<EditableKind, string> = { receiving: "Supplier's Form / receiving", transfers: 'Pull-Out / transfer' };

/**
 * Editing warehouse entries (owner request 2026-09-25).
 * - The person who prepared a DRAFT (or SUBMITTED, not yet approved) document edits it directly.
 * - Anyone else with `warehouse.edit_others` (Warehouse In-Charge; Admin) proposes an edit. The preparer is notified and must
 *   ACCEPT it (a person-targeted WAREHOUSE_EDIT approval) before anything changes; REJECT leaves the document as it was.
 * Every step is audit-logged with the person who did it.
 */
@Injectable()
export class EditsService implements OnModuleInit {
  private log = new Logger('Edits');
  constructor(private prisma: PrismaService, private approvals: ApprovalsService, private audit: AuditService, private notify: NotificationsService, private receiving: ReceivingService, private transfers: TransfersService, private revisions: RevisionsService) {}

  onModuleInit() {
    this.approvals.register('WAREHOUSE_EDIT', async (req, outcome, actor) => {
      if (outcome !== 'APPROVED') return;
      const s = req.summary as { kind: EditableKind; payload: ReceivingEditInput | TransferEditInput; changes: string[]; controlNo: string };
      await requestContext.runSystem(async () => {
        try {
          await this.apply(s.kind, req.documentId, s.payload, req.requestedBy, null);
          await this.audit.log({ action: 'EDIT_APPLIED', entityType: DOC_TYPE[s.kind], entityId: req.documentId, userId: req.requestedBy, after: { acceptedBy: actor?.id ?? null, changes: s.changes, approvalRequestId: req.id } });
          const snap = await this.snapshot(s.kind, req.documentId);
          await this.revisions.record({ source: 'WAREHOUSE_EDIT', documentType: DOC_TYPE[s.kind], documentId: req.documentId, controlNo: s.controlNo, locationId: snap.locationId, staffUserId: snap.createdBy, requestedBy: req.requestedBy, approvedBy: actor?.id ?? null, reason: 'Edit by the Warehouse In-Charge, accepted by the preparer', changes: s.changes, link: `/${s.kind}/${req.documentId}` });
        } catch (e) {
          // The document moved on (approved / posted / voided) before the preparer accepted: nothing is changed.
          this.log.warn(`WAREHOUSE_EDIT ${req.id} not applied: ${(e as Error).message}`);
          await this.audit.log({ action: 'EDIT_NOT_APPLIED', entityType: DOC_TYPE[s.kind], entityId: req.documentId, userId: actor?.id ?? null, after: { reason: (e as Error).message, approvalRequestId: req.id } });
          await this.notify.toUsers([req.requestedBy, ...(actor ? [actor.id] : [])], { type: 'EDIT_NOT_APPLIED', title: `Edit to ${s.controlNo} was not applied`, body: (e as Error).message, link: `/${s.kind}/${req.documentId}` });
        }
      });
    });
  }

  private snapshot(kind: EditableKind, id: string) { return kind === 'receiving' ? this.receiving.editSnapshot(id) : this.transfers.editSnapshot(id); }
  private apply(kind: EditableKind, id: string, payload: ReceivingEditInput | TransferEditInput, actorId: string, editor: SessionUser | null) {
    return kind === 'receiving' ? this.receiving.applyEdit(id, payload as ReceivingEditInput, actorId, editor) : this.transfers.applyEdit(id, payload as TransferEditInput, actorId, editor);
  }

  /** Proposed "after" snapshot, built from the payload with product / location names so the preparer sees exactly what changes. */
  private async proposedSnap(kind: EditableKind, before: Awaited<ReturnType<EditsService['snapshot']>>, payload: ReceivingEditInput | TransferEditInput): Promise<Snap> {
    const products = await this.prisma.db.product.findMany({ where: { id: { in: payload.lines.map((l) => l.productId) } }, select: { id: true, name: true } });
    const name = (id: string) => products.find((p) => p.id === id)?.name ?? id;
    if (kind === 'receiving') {
      const p = payload as ReceivingEditInput;
      const supplier = p.supplierId ? (await this.prisma.db.supplier.findUniqueOrThrow({ where: { id: p.supplierId }, select: { code: true } })).code : (before.header as Record<string, string>).supplier;
      const h = before.header as Record<string, string>;
      return { header: { supplier, supplierRef: p.supplierRef ?? (p.supplierRef === null ? '' : h.supplierRef), docDate: p.docDate ?? h.docDate, notes: p.notes ?? (p.notes === null ? '' : h.notes) }, lines: p.lines.map((l) => ({ product: name(l.productId), qty: l.qty, freeQty: l.freeQty ?? 0, expiryDate: l.expiryDate ?? '', batchNo: l.batchNo ?? '', remarks: l.remarks ?? '' })) };
    }
    const p = payload as TransferEditInput; const h = before.header as Record<string, string>;
    const to = p.toLocationId ? (await this.prisma.db.location.findUniqueOrThrow({ where: { id: p.toLocationId }, select: { name: true } })).name : h.to;
    const qty = new Map<string, number>(); for (const l of p.lines) qty.set(name(l.productId), (qty.get(name(l.productId)) ?? 0) + l.qty);
    return { header: { to, transferType: p.transferType ?? h.transferType, returnReason: p.returnReason ?? (p.returnReason === null ? '' : h.returnReason), docDate: p.docDate ?? h.docDate, notes: p.notes ?? (p.notes === null ? '' : h.notes) }, lines: [...qty].map(([product, q]) => ({ product, qty: q })) };
  }

  async edit(kind: EditableKind, id: string, payload: ReceivingEditInput | TransferEditInput, user: SessionUser) {
    if (!DOC_TYPE[kind]) throw new NotFoundException();
    const before = await this.snapshot(kind, id).catch(() => { throw new NotFoundException(); });
    if (user.locationScoped && !user.locationIds.includes(before.locationId)) throw new ForbiddenException('Location outside your assignment');
    if (!['DRAFT', 'SUBMITTED'].includes(before.status)) throw new BadRequestException(`A ${before.status} document can no longer be edited`);
    if ('unitCost' in (payload.lines[0] ?? {}) && payload.lines.some((l) => (l as { unitCost?: number | null }).unitCost != null) && !user.permissions.has('cost.edit')) throw new ForbiddenException('You may not enter cost');
    const after = await this.proposedSnap(kind, before, payload);
    const changes = describeChanges(before as unknown as Snap, after);
    if (!changes.length) throw new BadRequestException('Nothing changed');
    const pending = await this.prisma.db.approvalRequest.findFirst({ where: { type: 'WAREHOUSE_EDIT', documentType: DOC_TYPE[kind], documentId: id, status: 'PENDING' } });
    if (pending) throw new BadRequestException('Another edit to this document is still waiting for acceptance');

    const own = before.createdBy === user.id;
    if (own) {
      if (!user.permissions.has(kind === 'receiving' ? 'receiving.create' : 'transfer.create')) throw new ForbiddenException();
      await this.apply(kind, id, payload, user.id, user);
      await this.audit.log({ action: 'EDIT', entityType: DOC_TYPE[kind], entityId: id, after: { changes } });
      return { applied: true, changes };
    }
    if (!user.permissions.has('warehouse.edit_others')) throw new ForbiddenException('Only the person who prepared this document can change it');
    if (!before.createdBy) throw new BadRequestException('This document has no preparer on record; void and re-enter it instead');
    const preparer = await this.prisma.db.user.findUnique({ where: { id: before.createdBy }, select: { id: true, fullName: true, active: true } });
    if (!preparer?.active) throw new BadRequestException('The preparer\'s account is inactive; void and re-enter the document instead');
    // Validate now (FEFO stock, expiry rules, route) so the preparer is never asked to accept an edit that cannot be applied.
    await this.dryRun(kind, id, payload, user);
    const req = await this.approvals.request({
      type: 'WAREHOUSE_EDIT', documentType: DOC_TYPE[kind], documentId: id, requestedBy: user.id, approverUserIds: [preparer.id],
      summary: { kind, controlNo: before.controlNo, document: LABEL[kind], locationId: before.locationId, locationName: before.locationName, proposedBy: user.fullName, preparedBy: preparer.fullName, status: before.status, changes, payload },
    });
    await this.audit.log({ action: 'EDIT_PROPOSED', entityType: DOC_TYPE[kind], entityId: id, after: { changes, approvalRequestId: req.id, awaiting: preparer.fullName } });
    return { applied: false, awaiting: preparer.fullName, approvalRequestId: req.id, changes };
  }

  /** Runs the edit inside a transaction that is always rolled back, to surface validation errors at proposal time. */
  private async dryRun(kind: EditableKind, id: string, payload: ReceivingEditInput | TransferEditInput, user: SessionUser) {
    if (kind === 'receiving') {
      const p = payload as ReceivingEditInput;
      if (!p.lines.length) throw new BadRequestException('At least one line is required');
      await this.receiving.validateLines(p.lines, user);
      return;
    }
    const p = payload as TransferEditInput;
    if (!p.lines.length) throw new BadRequestException('At least one line is required');
    const doc = await this.prisma.db.transferDoc.findUniqueOrThrow({ where: { id }, include: { fromLocation: true } });
    const toLoc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: p.toLocationId ?? doc.toLocationId } });
    this.transfers.assertRoute(user, doc.fromLocation, toLoc, p.transferType ?? doc.transferType);
    const ROLLBACK = new Error('dry-run');
    await this.prisma.db.$transaction(async (tx) => { await this.transfers.buildLines(tx, doc.fromLocation, p.transferType ?? doc.transferType, p.lines); throw ROLLBACK; }).catch((e) => { if (e !== ROLLBACK) throw e; });
  }

  /** Edit requests for one document (pending first), with who proposed and who decided. */
  async forDocument(kind: EditableKind, id: string, user: SessionUser) {
    const snap = await this.snapshot(kind, id).catch(() => { throw new NotFoundException(); });
    if (user.locationScoped && !user.locationIds.includes(snap.locationId) && !(kind === 'transfers' && user.locationIds.includes((snap as { header: { toLocationId?: string } }).header.toLocationId ?? ''))) throw new ForbiddenException();
    const rows = await this.prisma.db.approvalRequest.findMany({ where: { type: 'WAREHOUSE_EDIT', documentType: DOC_TYPE[kind], documentId: id }, include: { decisions: { include: { user: { select: { fullName: true } } } } }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => { const s = r.summary as { proposedBy?: string; preparedBy?: string; changes?: string[] } | null; return { id: r.id, status: r.status, createdAt: r.createdAt, decidedAt: r.decidedAt, proposedBy: s?.proposedBy, preparedBy: s?.preparedBy, changes: s?.changes ?? [], awaitingMe: r.status === 'PENDING' && r.requiredApproverUserIds.includes(user.id), decisions: r.decisions.map((d) => ({ by: d.user.fullName, decision: d.decision, note: d.note, at: d.decidedAt })) }; });
  }
}
