import { Controller, ForbiddenException, Get, NotFoundException, Param } from '@nestjs/common';
import { CurrentUser, RequireAnyPermission } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import type { SessionUser } from '../common/request-context';

/** Entity types whose "who did what" trail can be opened from the document screen, with the locations that grant access. */
const LOCATED: Record<string, (db: PrismaService['db'], id: string) => Promise<string[] | null>> = {
  ReceivingDoc: async (db, id) => { const d = await db.receivingDoc.findUnique({ where: { id }, select: { locationId: true } }); return d ? [d.locationId] : null; },
  TransferDoc: async (db, id) => { const d = await db.transferDoc.findUnique({ where: { id }, select: { fromLocationId: true, toLocationId: true } }); return d ? [d.fromLocationId, d.toLocationId] : null; },
  SalesDoc: async (db, id) => { const d = await db.salesDoc.findUnique({ where: { id }, select: { locationId: true } }); return d ? [d.locationId] : null; },
  ExpenseDoc: async (db, id) => { const d = await db.expenseDoc.findUnique({ where: { id }, select: { locationId: true } }); return d ? [d.locationId] : null; },
  CountDoc: async (db, id) => { const d = await db.countDoc.findUnique({ where: { id }, select: { locationId: true } }); return d ? [d.locationId] : null; },
};

/**
 * GET /api/history/:entityType/:id — every recorded action on a document with the person who did it (name, role, time, IP).
 * Accounts are personal, so this is the liability trail. Only names/actions are returned (no before/after payloads, so no cost leaks).
 */
@Controller('api/history')
export class HistoryController {
  constructor(private prisma: PrismaService) {}
  @Get(':entityType/:id') @RequireAnyPermission('report.inventory.own', 'report.inventory.all', 'report.sales.own', 'report.sales.all', 'receiving.create', 'transfer.create', 'transfer.confirm', 'sale.create', 'expense.view', 'count.create', 'audit_log.view')
  async history(@Param('entityType') entityType: string, @Param('id') id: string, @CurrentUser() u: SessionUser) {
    const locate = LOCATED[entityType]; if (!locate) throw new NotFoundException();
    const locs = await locate(this.prisma.db, id); if (!locs) throw new NotFoundException();
    if (u.locationScoped && !locs.some((l) => u.locationIds.includes(l))) throw new ForbiddenException();
    const rows = await this.prisma.db.auditLog.findMany({ where: { entityType, entityId: id }, include: { user: { select: { fullName: true, username: true, idNumber: true, role: { select: { name: true } } } } }, orderBy: { at: 'asc' } });
    const approvals = await this.prisma.db.approvalRequest.findMany({ where: { documentType: entityType, documentId: id }, include: { decisions: { include: { user: { select: { fullName: true, username: true, idNumber: true, role: { select: { name: true } } } } } } } });
    const out: { at: Date; action: string; by: string; username: string | null; idNumber: string | null; role: string | null; ip: string | null; note?: string | null }[] = [];
    for (const r of rows) {
      const action = r.action.replace(/^(POST|PUT|PATCH|DELETE) .*/, 'REQUEST').toUpperCase();
      const prev = out[out.length - 1];
      // the HTTP interceptor and the service both log the same action; keep one row
      if (prev && prev.action === action && prev.username === (r.user?.username ?? null) && Math.abs(prev.at.getTime() - r.at.getTime()) < 5000) continue;
      if (action === 'REQUEST') continue;
      // the edit endpoint's own row duplicates the richer EDIT / EDIT_PROPOSED row written by the service
      if (action === 'EDIT' && rows.some((o) => o !== r && o.userId === r.userId && o.action === 'EDIT_PROPOSED' && Math.abs(o.at.getTime() - r.at.getTime()) < 5000)) continue;
      out.push({ at: r.at, action, by: r.user?.fullName ?? 'system (automatic)', username: r.user?.username ?? null, idNumber: r.user?.idNumber ?? null, role: r.user?.role.name ?? null, ip: r.ip });
    }
    for (const a of approvals) for (const d of a.decisions) if (!out.some((o) => o.action === d.decision && o.username === d.user.username && Math.abs(o.at.getTime() - d.decidedAt.getTime()) < 5000)) out.push({ at: d.decidedAt, action: a.type === 'WAREHOUSE_EDIT' ? (d.decision === 'APPROVE' ? 'ACCEPTED EDIT' : 'REJECTED EDIT') : `${d.decision} (${a.type.replace(/_/g, ' ').toLowerCase()})`, by: d.user.fullName, username: d.user.username, idNumber: d.user.idNumber, role: d.user.role.name, ip: null, note: d.note });
    return out.sort((x, y) => x.at.getTime() - y.at.getTime());
  }
}
