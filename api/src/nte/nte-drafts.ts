import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../common/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';

/** The default words of an NTE made from an HR notice (HR may change them before issuing). */
export function noticeText(n: { kind: string; title: string; details: unknown }): string {
  const d = (n.details ?? {}) as Record<string, unknown>;
  const ask = '\n\nPlease explain in writing why this happened.';
  if (n.kind === 'CASH_DEPOSIT_OVERDUE') return `${n.title}.${d.outstanding ? ` Amount not deposited: ₱${d.outstanding}.` : ''}${d.dueDate ? ` It was due on ${d.dueDate}.` : ''}${ask.replace('this happened', 'the cash was not deposited on time')}`;
  if (n.kind === 'TRANSFER_DISCREPANCY') return `${n.title}. Difference: ${d.items ?? ''}. Decision: ${d.outcomeLabel ?? ''}. Your part: ${d.role ?? ''}.${ask.replace('this happened', 'the difference happened')}`;
  if (n.kind === 'POST_CLOSE_EDITS') return `${n.title}. Post-close edits asked this month: ${d.countInMonth ?? ''}${d.inARow ? ' (3 days in a row)' : ''}.${ask.replace('this happened', 'the entries had to be corrected after the day was closed')}`;
  if (n.kind === 'COUNT_DISCREPANCY') return `${n.title}. ${d.summary ?? ''}${ask.replace('this happened', 'the count did not match')}`;
  return `${n.title}.${ask}`;
}

/**
 * After an HR notice is created or updated (owner request 2026-10-19): add each person's employee record and position to the notice,
 * make a DRAFT NTE for each person the notice clearly names (HR reviews and issues it; nothing reaches the employee by itself),
 * and tell HR with a notification that carries the notice id so the Create NTE button works from the bell and the dashboard.
 */
export async function afterHrNotice(prisma: PrismaService, notify: NotificationsService, noticeId: string, o: { type: string; title: string; body?: string; roles?: ('HR_STAFF' | 'ADMIN')[]; link?: string }) {
  const notice = await prisma.db.hrNotice.findUnique({ where: { id: noticeId } }); if (!notice) return null;
  const people = ((notice.staffIds ?? []) as { id: string; name: string }[]);
  const emps = people.length ? await prisma.db.employee.findMany({ where: { userId: { in: people.map((p) => p.id) } }, select: { id: true, userId: true, position: true, fullName: true } }) : [];
  const enriched = people.map((p) => { const e = emps.find((x) => x.userId === p.id); return { ...p, employeeId: e?.id ?? null, position: e?.position ?? null }; });
  await prisma.db.hrNotice.update({ where: { id: noticeId }, data: { staffIds: enriched as unknown as Prisma.InputJsonValue } });
  const ambiguous = !!(notice.details as { ambiguous?: boolean } | null)?.ambiguous;
  let drafts = 0;
  if (!ambiguous) for (const p of enriched) {
    if (!p.employeeId) continue;
    const exists = await prisma.db.nte.findFirst({ where: { hrNoticeId: noticeId, employeeId: p.employeeId }, select: { id: true } }); if (exists) continue;
    const emp = emps.find((e) => e.id === p.employeeId)!;
    await prisma.db.nte.create({ data: { employeeId: emp.id, employeeName: emp.fullName, locationId: notice.locationId, hrNoticeId: noticeId, subject: notice.title, details: noticeText(notice), incidentDate: null, issuedOn: new Date(), replyDueOn: new Date(), status: 'DRAFT', issuedBy: 'system' } });
    drafts++;
  }
  const open = await prisma.db.nte.count({ where: { hrNoticeId: noticeId, status: 'DRAFT' } });
  await notify.toRoles(o.roles ?? ['HR_STAFF', 'ADMIN'], { type: o.type, title: o.title, body: o.body ?? (open ? `${open} NTE draft${open > 1 ? 's' : ''} ready: review and issue.` : ambiguous ? 'Choose who must explain, then create the NTE.' : undefined), link: o.link ?? '/hr-notices', data: { hrNoticeId: noticeId, drafts: open } });
  return { drafts };
}
