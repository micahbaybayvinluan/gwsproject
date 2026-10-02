import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma.service';
import type { SessionUser } from '../common/request-context';

export const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const STAGES = ['PROSPECT', 'VISITED', 'SAMPLE_GIVEN', 'FIRST_ORDER', 'REGULAR'] as const;
export type Stage = (typeof STAGES)[number];
export const stageRank = (s: string) => STAGES.indexOf(s as Stage);
export const SHELF = ['ON_SHELF', 'LOW_STOCK', 'OUT_OF_STOCK', 'NOT_CARRIED'] as const;
export const CLAIM_KINDS = ['FUEL', 'TRANSPORT', 'MEAL', 'OTHER'] as const;
/** The editable text fields of an approved outlet: an agent asks for a change, the Sales Manager approves it, the Owner is told. */
export const OUTLET_FIELDS = ['name', 'outletType', 'address', 'city', 'contactName', 'phone', 'email', 'notes'] as const;
export const FIELD_LABEL: Record<string, string> = { name: 'Name', outletType: 'Type', address: 'Address', city: 'City', contactName: 'Contact person', phone: 'Phone', email: 'Email', notes: 'Notes', areaId: 'Area' };

/** Sees every agent's outlets, itineraries and photos: Sales Manager, Head Auditor, Owner. */
export const canViewAll = (u: SessionUser) => u.permissions.has('outlet.view.all') || u.permissions.has('outlet.manage');
export const isManager = (u: SessionUser) => u.permissions.has('outlet.manage');
export function requireAgent(u: SessionUser) { if (!u.permissions.has('agent.self')) throw new ForbiddenException('This is for sales agents'); }

/** Outlets an agent works with: their own and the ones shared with them. */
export const outletsOf = (agentKey: string) => ({ OR: [{ agentKey }, { shares: { some: { agentKey } } }] });

/** The pictures (images) attached to documents, first one first. */
export async function photosFor(prisma: PrismaService, documentType: string, ids: string[]) {
  const out = new Map<string, { id: string; createdAt: Date; fileName: string }[]>();
  if (!ids.length) return out;
  const rows = await prisma.db.attachment.findMany({ where: { documentType, documentId: { in: ids }, contentType: { startsWith: 'image/' } }, orderBy: { createdAt: 'asc' }, select: { id: true, documentId: true, createdAt: true, fileName: true } });
  for (const r of rows) { const a = out.get(r.documentId) ?? []; a.push({ id: r.id, createdAt: r.createdAt, fileName: r.fileName }); out.set(r.documentId, a); }
  return out;
}

export function parseDay(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(t);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  return null;
}
export function need<T>(v: T | null | undefined, msg: string): T { if (v == null || (typeof v === 'string' && !v.trim())) throw new BadRequestException(msg); return v; }
