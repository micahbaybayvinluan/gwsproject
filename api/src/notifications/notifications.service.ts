import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import type { RoleKey } from '../common/permissions';
import nodemailer from 'nodemailer';

export interface Notify { type: string; title: string; body?: string; link?: string }

/** §12 notifications: in-app bell + optional daily email digest. */
@Injectable()
export class NotificationsService {
  private log = new Logger('Notifications');
  constructor(private prisma: PrismaService) {}

  async toUsers(userIds: string[], n: Notify) {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (!ids.length) return;
    await this.prisma.db.notification.createMany({ data: ids.map((userId) => ({ userId, ...n })) });
  }
  async toRoles(roles: RoleKey[], n: Notify) {
    const users = await this.prisma.db.user.findMany({ where: { active: true, role: { key: { in: roles } } }, select: { id: true } });
    await this.toUsers(users.map((u) => u.id), n);
  }
  /** Users assigned to a location (sales associates, franchise owner/associates, warehouse staff). */
  async toLocation(locationId: string, n: Notify, extraRoles: RoleKey[] = []) {
    const users = await this.prisma.db.user.findMany({ where: { active: true, OR: [{ assignments: { some: { locationId } } }, { ownedFranchises: { some: { id: locationId } } }, ...(extraRoles.length ? [{ role: { key: { in: extraRoles } } }] : [])] }, select: { id: true } });
    await this.toUsers(users.map((u) => u.id), n);
  }
  /** Newest first. A search matches every word typed (any order) in the title or the text, over all of the user's notifications, not just the latest. */
  list(userId: string, unreadOnly = false, search?: string) {
    const words = (search ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
    const and = words.map((w) => ({ OR: [{ title: { contains: w, mode: 'insensitive' as const } }, { body: { contains: w, mode: 'insensitive' as const } }] }));
    return this.prisma.db.notification.findMany({ where: { userId, readAt: unreadOnly ? null : undefined, AND: and }, orderBy: { createdAt: 'desc' }, take: words.length ? 300 : 100 });
  }
  unreadCount(userId: string) { return this.prisma.db.notification.count({ where: { userId, readAt: null } }); }
  markRead(userId: string, ids?: string[]) { return this.prisma.db.notification.updateMany({ where: { userId, readAt: null, id: ids ? { in: ids } : undefined }, data: { readAt: new Date() } }); }

  /** Daily email digest job: one email per user with unread, un-emailed notifications. */
  async sendDigests() {
    if (!process.env.SMTP_URL) { this.log.debug('SMTP_URL not set; digest skipped'); return { sent: 0 }; }
    const transport = nodemailer.createTransport(process.env.SMTP_URL);
    const users = await this.prisma.db.user.findMany({ where: { active: true, emailDigest: true, notifications: { some: { readAt: null, emailedAt: null } } }, include: { notifications: { where: { readAt: null, emailedAt: null }, orderBy: { createdAt: 'desc' } } } });
    let sent = 0;
    for (const u of users) {
      const lines = u.notifications.map((n) => `• ${n.title}${n.body ? ` — ${n.body}` : ''}`).join('\n');
      await transport.sendMail({ from: process.env.MAIL_FROM || 'noreply@gws.local', to: u.email, subject: `GWS-ERP digest: ${u.notifications.length} notifications`, text: lines });
      await this.prisma.db.notification.updateMany({ where: { id: { in: u.notifications.map((n) => n.id) } }, data: { emailedAt: new Date() } });
      sent++;
    }
    return { sent };
  }
}
