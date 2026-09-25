import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { PrismaService } from '../common/prisma.service';
import { SessionStore } from './session.store';
import { AuditService } from '../common/audit.service';
import { SettingsService } from '../common/settings.service';
import { LOCATION_SCOPED_ROLES, LONG_SESSION_ROLES, TOTP_REQUIRED_ROLES, effectivePermissions, RoleKey } from '../common/permissions';
import type { SessionUser } from '../common/request-context';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private sessions: SessionStore, private audit: AuditService, private settings: SettingsService) {}

  async login(identifier: string, password: string, meta: { ip?: string; userAgent?: string }) {
    const user = await this.prisma.db.user.findFirst({ where: { OR: [{ username: identifier }, { email: identifier.toLowerCase() }] }, include: { role: true } });
    const ok = user && user.active && (await argon2.verify(user.passwordHash, password).catch(() => false));
    if (!ok || !user) {
      await this.audit.log({ action: 'LOGIN_FAILED', entityType: 'User', entityId: user?.id ?? null, after: { identifier }, userId: user?.id ?? null });
      throw new UnauthorizedException('Invalid credentials');
    }
    const roleKey = user.role.key as RoleKey;
    // AUTH_TOTP_OPTIONAL=true relaxes the mandatory 2FA for Admin / auditors / Accounting Head (development & simulation only; keep false in production)
    const totpRequired = (TOTP_REQUIRED_ROLES.includes(roleKey) && process.env.AUTH_TOTP_OPTIONAL !== 'true') || user.totpEnabled;
    const idleMinutes = LONG_SESSION_ROLES.includes(roleKey)
      ? await this.settings.get<number>('session.idle_minutes_long')
      : await this.settings.get<number>('session.idle_minutes_default');
    const sessionId = await this.sessions.create({
      userId: user.id, roleKey, totpVerified: !totpRequired, idleSeconds: idleMinutes * 60, createdAt: Date.now(), ip: meta.ip, userAgent: meta.userAgent,
    });
    await this.prisma.db.loginSessionRecord.create({ data: { userId: user.id, sessionId, ip: meta.ip, userAgent: meta.userAgent } });
    // One person, one active session: once this sign-in is complete (after 2FA where required) every other session of the account ends.
    if (!totpRequired) await this.endOtherSessions(user.id, sessionId, meta);
    await this.prisma.db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ action: 'LOGIN', entityType: 'User', entityId: user.id, userId: user.id });
    return {
      sessionId,
      totpRequired,
      totpEnrolled: user.totpEnabled,
      mustChangePassword: user.mustChangePassword,
    };
  }

  /** Second step for 2FA roles. If not enrolled yet, the client must call setupTotp then verify. */
  async verifyTotp(sessionId: string, code: string) {
    const sess = await this.sessions.get(sessionId);
    if (!sess) throw new UnauthorizedException();
    const user = await this.prisma.db.user.findUniqueOrThrow({ where: { id: sess.userId } });
    if (!user.totpSecret) throw new BadRequestException('TOTP not enrolled; call /auth/totp/setup first');
    if (!authenticator.check(code, user.totpSecret)) {
      await this.audit.log({ action: 'TOTP_FAILED', entityType: 'User', entityId: user.id, userId: user.id });
      throw new UnauthorizedException('Invalid code');
    }
    if (!user.totpEnabled) await this.prisma.db.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
    await this.sessions.update(sessionId, { totpVerified: true });
    await this.endOtherSessions(user.id, sessionId, { ip: sess.ip, userAgent: sess.userAgent });
    return { ok: true };
  }

  async setupTotp(sessionId: string) {
    const sess = await this.sessions.get(sessionId);
    if (!sess) throw new UnauthorizedException();
    const user = await this.prisma.db.user.findUniqueOrThrow({ where: { id: sess.userId } });
    if (user.totpEnabled) throw new ForbiddenException('TOTP already enrolled; ask an Admin to reset it');
    const secret = authenticator.generateSecret();
    await this.prisma.db.user.update({ where: { id: user.id }, data: { totpSecret: secret } });
    return { secret, otpauthUrl: authenticator.keyuri(user.username, 'GWS-ERP', secret) };
  }

  /** Accounts are personal (owner rule): a new sign-in signs out every other device, and the person is told where it happened. */
  async endOtherSessions(userId: string, keep: string, meta: { ip?: string; userAgent?: string }) {
    const others = (await this.sessions.listForUser(userId)).filter((id) => id !== keep);
    if (!others.length) return 0;
    for (const id of others) { await this.sessions.destroy(id); await this.sessions.markReplaced(id); }
    await this.prisma.db.loginSessionRecord.updateMany({ where: { userId, sessionId: { in: others }, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log({ action: 'SESSION_REPLACED', entityType: 'User', entityId: userId, userId, after: { endedSessions: others.length, newSignInIp: meta.ip ?? null, newSignInDevice: meta.userAgent ?? null } });
    await this.prisma.db.notification.create({ data: { userId, type: 'SESSION_REPLACED', title: 'Your account was signed in on another device', body: `Other sessions were signed out${meta.ip ? ` (new sign-in from ${meta.ip})` : ''}. If this was not you, tell the Admin and change your password.`, link: '/' } }).catch(() => undefined);
    return others.length;
  }

  async acceptAccountability(userId: string, ip?: string) {
    const user = await this.prisma.db.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true } });
    if (user.accountabilityAcceptedAt) return { ok: true, acceptedAt: user.accountabilityAcceptedAt };
    const acceptedAt = new Date();
    await this.prisma.db.user.update({ where: { id: userId }, data: { accountabilityAcceptedAt: acceptedAt, accountabilityIp: ip ?? null } });
    await this.audit.log({ action: 'ACCOUNTABILITY_ACCEPTED', entityType: 'User', entityId: userId, userId, after: { statement: accountabilityStatement(user.fullName, user.idNumber, user.username, user.role.name), acceptedAt } });
    return { ok: true, acceptedAt };
  }

  async logout(sessionId: string) {
    await this.sessions.destroy(sessionId);
    await this.prisma.db.loginSessionRecord.updateMany({ where: { sessionId }, data: { revokedAt: new Date() } });
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.prisma.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, current))) throw new UnauthorizedException('Current password is wrong');
    if (next.length < 10) throw new BadRequestException('Password must be at least 10 characters');
    if (next === current) throw new BadRequestException('Choose a new password different from the current one');
    await this.prisma.db.user.update({ where: { id: userId }, data: { passwordHash: await argon2.hash(next), mustChangePassword: false } });
    await this.audit.log({ action: 'PASSWORD_CHANGED', entityType: 'User', entityId: userId, userId });
    return { ok: true };
  }

  /** Resolve a session id into the SessionUser attached to every request. */
  async resolve(sessionId: string): Promise<SessionUser | null> {
    const sess = await this.sessions.get(sessionId);
    if (!sess) return null;
    const user = await this.prisma.db.user.findUnique({ where: { id: sess.userId }, include: { role: true, assignments: true, permissionOverrides: true } });
    if (!user || !user.active) return null;
    const roleKey = user.role.key as RoleKey;
    const permissions = effectivePermissions(user.role.permissions as string[], user.permissionOverrides);
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      roleKey,
      permissions,
      locationIds: user.assignments.map((a) => a.locationId),
      locationScoped: LOCATION_SCOPED_ROLES.includes(roleKey),
      sessionId,
      totpVerified: sess.totpVerified,
      mustChangePassword: user.mustChangePassword,
      accountabilityAccepted: !!user.accountabilityAcceptedAt,
    };
  }
}

/** The statement each person accepts on first sign-in (stored verbatim in the audit log). */
export function accountabilityStatement(fullName: string, idNumber: string | null, username: string, roleName: string) {
  return `I, ${fullName}${idNumber ? ` (ID ${idNumber})` : ''}, confirm that the account "${username}" (${roleName}) is assigned to me alone. I will not share my password or let anyone else use this account. Every transaction, approval, edit and export recorded under this account is my responsibility.`;
}
