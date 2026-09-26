import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { dateStr, toDateOnly } from '../common/manila';

export type RevisionSource = 'AUDIT_REVISION' | 'POST_CLOSE_EDIT' | 'WAREHOUSE_EDIT' | 'COUNT_REVISION' | 'ACCOUNTING_EDIT';
const SOURCE_LABEL: Record<string, string> = { AUDIT_REVISION: 'Audit revision (Audit Associate → Head Auditor)', POST_CLOSE_EDIT: 'Post-close edit', WAREHOUSE_EDIT: 'Warehouse edit (In-Charge, accepted by preparer)', COUNT_REVISION: 'Count sheet revision', ACCOUNTING_EDIT: 'Journal entry edited by Accounting' };

/** Revision log (owner request 2026-09-26): every approved correction is recorded against the person whose document it was. */
@Injectable()
export class RevisionsService {
  constructor(private prisma: PrismaService, private notify: NotificationsService) {}

  async record(input: { source: RevisionSource; documentType: string; documentId: string; controlNo?: string | null; locationId?: string | null; staffUserId?: string | null; requestedBy?: string | null; approvedBy?: string | null; reason?: string | null; changes?: unknown; link?: string }) {
    const r = await this.prisma.db.documentRevision.create({ data: { source: input.source, documentType: input.documentType, documentId: input.documentId, controlNo: input.controlNo ?? null, locationId: input.locationId ?? null, staffUserId: input.staffUserId ?? null, requestedBy: input.requestedBy ?? null, approvedBy: input.approvedBy ?? null, reason: input.reason ?? null, changes: input.changes === undefined ? undefined : (JSON.parse(JSON.stringify(input.changes)) as Prisma.InputJsonValue) } });
    if (input.staffUserId && input.staffUserId !== input.requestedBy) await this.notify.toUsers([input.staffUserId], { type: 'DOCUMENT_REVISED', title: `Your ${input.documentType.replace(/Doc$/, '').toLowerCase()} ${input.controlNo ?? ''} was corrected (${SOURCE_LABEL[input.source]})`, body: input.reason ?? undefined, link: input.link }).catch(() => undefined);
    return r;
  }

  /** Log with names, newest first. */
  async list(q: { from?: string; to?: string; staffUserId?: string; source?: string }) {
    const rows = await this.prisma.db.documentRevision.findMany({ where: { staffUserId: q.staffUserId || undefined, source: q.source || undefined, createdAt: q.from || q.to ? { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? new Date(toDateOnly(q.to).getTime() + 86399999) : undefined } : undefined }, orderBy: { createdAt: 'desc' }, take: 1000 });
    const ids = [...new Set(rows.flatMap((r) => [r.staffUserId, r.requestedBy, r.approvedBy]).filter((x): x is string => !!x))];
    const users = await this.prisma.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, idNumber: true } });
    const locs = await this.prisma.db.location.findMany({ where: { id: { in: rows.map((r) => r.locationId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    const n = (id: string | null) => users.find((u) => u.id === id)?.fullName ?? null;
    return rows.map((r) => ({ ...r, sourceLabel: SOURCE_LABEL[r.source] ?? r.source, staff: n(r.staffUserId), requestedByName: n(r.requestedBy), approvedByName: n(r.approvedBy), location: locs.find((l) => l.id === r.locationId)?.name ?? null, date: dateStr(r.createdAt) }));
  }

  /** Errors per staff member (number of corrections of their documents) for the period. */
  async byStaff(q: { from?: string; to?: string }) {
    const rows = await this.list(q);
    const map = new Map<string, { staffUserId: string; staff: string; total: number; bySource: Record<string, number>; lastAt: Date }>();
    for (const r of rows) { if (!r.staffUserId) continue; const cur = map.get(r.staffUserId) ?? { staffUserId: r.staffUserId, staff: r.staff ?? '', total: 0, bySource: {}, lastAt: r.createdAt }; cur.total++; cur.bySource[r.source] = (cur.bySource[r.source] ?? 0) + 1; if (r.createdAt > cur.lastAt) cur.lastAt = r.createdAt; map.set(r.staffUserId, cur); }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }
}
