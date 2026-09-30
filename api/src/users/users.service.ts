import { MasterDataApprovals } from '../approvals/master-data.service';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '../common/request-context';
import * as argon2 from 'argon2';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SessionStore } from '../auth/session.store';
import { NotificationsService } from '../notifications/notifications.service';
import { PERMISSION_KEYS, ROLE_BY_KEY, SINGLE_LOCATION_ROLES } from '../common/permissions';

export interface CreateUserInput { username: string; email?: string; fullName: string; idNumber: string; roleKey: string; password?: string; passwordHash?: string; locationIds?: string[]; employeeId?: string }

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private audit: AuditService, private sessions: SessionStore, private md: MasterDataApprovals, private notify: NotificationsService) {
    md.registerKind('UserAccount', { label: 'User account', apply: (p, by) => this.create(p as unknown as CreateUserInput, by), link: () => '/users' });
  }

  private select = { id: true, username: true, email: true, fullName: true, idNumber: true, accountabilityAcceptedAt: true, active: true, mustChangePassword: true, totpEnabled: true, lastLoginAt: true, createdAt: true, role: { select: { key: true, name: true } }, assignments: { select: { location: { select: { id: true, code: true, name: true, type: true } } } }, permissionOverrides: { select: { permissionKey: true, granted: true } } } as const;

  list() { return this.prisma.db.user.findMany({ select: this.select, orderBy: { username: 'asc' } }); }
  async get(id: string) { const u = await this.prisma.db.user.findUnique({ where: { id }, select: this.select }); if (!u) throw new NotFoundException(); return u; }

  /** The Owner's new users are created at once; anyone else with user.manage waits for the Owner. */
  async createGated(input: CreateUserInput, user: SessionUser) {
    input = { ...input, email: this.emailOf(input) };
    // check here so the person entering it sees the problem now, not the Owner at approval time
    if (!(await this.prisma.db.role.findUnique({ where: { key: input.roleKey } }))) throw new BadRequestException('Unknown role');
    this.validateAssignments(input.roleKey, input.locationIds ?? []);
    await this.assertFree(input.username, input.email!);
    const { password, ...rest } = input;
    // the temporary password never sits in the request in plain text
    const payload = user.roleKey === 'ADMIN' ? rest : { ...rest, passwordHash: await argon2.hash(password ?? '') };
    return this.md.submit('UserAccount', payload, user, { name: input.fullName, username: input.username, email: input.email, role: input.roleKey, companyId: input.idNumber }, () => this.create(input, user.id));
  }

  async create(input: CreateUserInput, actorId: string) {
    const role = await this.prisma.db.role.findUnique({ where: { key: input.roleKey } });
    if (!role) throw new BadRequestException('Unknown role');
    this.validateAssignments(input.roleKey, input.locationIds ?? []);
    await this.assertFree(input.username, this.emailOf(input));
    const user = await this.prisma.db.user.create({
      data: {
        username: input.username, email: this.emailOf(input), fullName: input.fullName, roleId: role.id,
        idNumber: input.idNumber, passwordHash: input.passwordHash ?? (await argon2.hash(input.password ?? '')), mustChangePassword: true, createdBy: actorId,
        assignments: { create: (input.locationIds ?? []).map((locationId) => ({ locationId })) },
      },
      select: this.select,
    });
    await this.audit.log({ action: 'CREATE', entityType: 'User', entityId: user.id, after: user });
    if (input.employeeId) await this.prisma.db.employee.update({ where: { id: input.employeeId }, data: { userId: user.id } });
    // HR is told of every new account, whoever opens it (owner request 2026-09-30); the password stays private to the person
    const by = await this.prisma.db.user.findUnique({ where: { id: actorId }, select: { fullName: true } });
    await this.notify.toRoles(['HR_STAFF'], { type: 'USER_CREATED', title: `New user account ${user.username} for ${user.fullName} (${user.role.name}) opened${by ? ` by ${by.fullName}` : ''}`, body: 'The person sets their own password at first sign-in; nobody else knows it. Give them their ID number and have them accept the accountability statement.', link: '/users' });
    return user;
  }

  /**
   * HR opens a user account for an employee (owner request 2026-09-26). The Owner approves before the account exists; the
   * temporary password is stored only as a hash in the request, and the person must change it at first sign-in.
   */
  async requestAccountForEmployee(employeeId: string, input: { username: string; email?: string; roleKey: string; locationIds?: string[]; password: string }, user: SessionUser) {
    const emp = await this.prisma.db.employee.findUnique({ where: { id: employeeId } });
    if (!emp) throw new NotFoundException('Employee not found');
    if (emp.userId) throw new BadRequestException('This employee already has a user account');
    if (['ADMIN', 'EXTERNAL_AUDITOR'].includes(input.roleKey)) throw new ForbiddenException('Only the Owner creates Admin and External Auditor accounts');
    if (!(await this.prisma.db.role.findUnique({ where: { key: input.roleKey } }))) throw new BadRequestException('Unknown role');
    this.validateAssignments(input.roleKey, input.locationIds ?? []);
    const email = this.emailOf(input);
    await this.assertFree(input.username, email);
    const locations = await this.prisma.db.location.findMany({ where: { id: { in: input.locationIds ?? [] } }, select: { name: true } });
    const payload = { username: input.username, email, fullName: emp.fullName, idNumber: emp.employeeNo, roleKey: input.roleKey, locationIds: input.locationIds ?? [], passwordHash: await argon2.hash(input.password), employeeId };
    return this.md.submit('UserAccount', payload, user, { name: emp.fullName, username: input.username, email, role: input.roleKey, branch: locations.map((l) => l.name).join(', '), companyId: emp.employeeNo }, () => this.create(payload, user.id));
  }

  async update(id: string, patch: { fullName?: string; idNumber?: string; email?: string; roleKey?: string; active?: boolean; locationIds?: string[]; resetPassword?: string; resetTotp?: boolean }, actorId: string) {
    const before = await this.get(id);
    const roleKey = patch.roleKey ?? before.role.key;
    if (patch.locationIds) this.validateAssignments(roleKey, patch.locationIds);
    const role = patch.roleKey ? await this.prisma.db.role.findUniqueOrThrow({ where: { key: patch.roleKey } }) : null;
    const user = await this.prisma.db.$transaction(async (tx) => {
      if (patch.locationIds) {
        await tx.userLocationAssignment.deleteMany({ where: { userId: id } });
        await tx.userLocationAssignment.createMany({ data: patch.locationIds.map((locationId) => ({ userId: id, locationId })) });
      }
      return tx.user.update({
        where: { id },
        data: {
          fullName: patch.fullName, idNumber: patch.idNumber, email: patch.email?.toLowerCase(), active: patch.active, roleId: role?.id, updatedBy: actorId,
          passwordHash: patch.resetPassword ? await argon2.hash(patch.resetPassword) : undefined,
          mustChangePassword: patch.resetPassword ? true : undefined,
          totpSecret: patch.resetTotp ? null : undefined, totpEnabled: patch.resetTotp ? false : undefined,
        },
        select: this.select,
      });
    });
    const personChanged = (patch.fullName !== undefined && patch.fullName !== before.fullName) || (patch.idNumber !== undefined && patch.idNumber !== before.idNumber);
    if (personChanged) await this.prisma.db.user.update({ where: { id }, data: { accountabilityAcceptedAt: null, accountabilityIp: null } });
    if (patch.active === false || patch.roleKey || patch.locationIds || patch.resetPassword || personChanged) await this.sessions.destroyAllForUser(id);
    await this.audit.log({ action: patch.roleKey || patch.locationIds ? 'PERMISSION_CHANGE' : 'UPDATE', entityType: 'User', entityId: id, before, after: user });
    return user;
  }

  async setOverrides(id: string, overrides: { permissionKey: string; granted: boolean }[], actorId: string) {
    for (const o of overrides) if (!PERMISSION_KEYS.includes(o.permissionKey)) throw new BadRequestException(`Unknown permission ${o.permissionKey}`);
    const before = await this.get(id);
    await this.prisma.db.$transaction([
      this.prisma.db.userPermissionOverride.deleteMany({ where: { userId: id } }),
      this.prisma.db.userPermissionOverride.createMany({ data: overrides.map((o) => ({ ...o, userId: id, createdBy: actorId })) }),
    ]);
    const after = await this.get(id);
    await this.audit.log({ action: 'PERMISSION_CHANGE', entityType: 'User', entityId: id, before: before.permissionOverrides, after: after.permissionOverrides });
    return after;
  }

  /** Recent sign-ins (IP / device) so the Admin can spot an account used from unexpected places. */
  logins(id: string) { return this.prisma.db.loginSessionRecord.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 30 }); }

  /** Staff without an email get a placeholder address, since each account needs a unique one. */
  private emailOf(input: { username: string; email?: string }) { return (input.email?.trim() || `${input.username}@gws.local`).toLowerCase(); }

  private async assertFree(username: string, email: string) {
    const taken = await this.prisma.db.user.findFirst({ where: { OR: [{ username: { equals: username, mode: 'insensitive' } }, { email }] }, select: { username: true } });
    if (taken) throw new BadRequestException(taken.username.toLowerCase() === username.toLowerCase() ? `The username "${username}" is already used. Choose another.` : `The email ${email} is already used by ${taken.username}.`);
  }

  private validateAssignments(roleKey: string, locationIds: string[]) {
    if (SINGLE_LOCATION_ROLES.includes(roleKey as never) && locationIds.length !== 1) {
      throw new BadRequestException(`${ROLE_BY_KEY[roleKey]?.name ?? roleKey} must be assigned exactly one branch. Choose the branch.`);
    }
  }

  roles() { return this.prisma.db.role.findMany({ orderBy: { key: 'asc' } }); }
  permissionKeys() { return PERMISSION_KEYS; }
  async updateRole(key: string, patch: { name?: string; description?: string; permissions?: string[] }) {
    if (patch.permissions) for (const k of patch.permissions) if (!PERMISSION_KEYS.includes(k)) throw new BadRequestException(`Unknown permission ${k}`);
    const before = await this.prisma.db.role.findUniqueOrThrow({ where: { key } });
    const after = await this.prisma.db.role.update({ where: { key }, data: patch });
    await this.audit.log({ action: 'PERMISSION_CHANGE', entityType: 'Role', entityId: key, before, after });
    return after;
  }
  async createCustomRole(input: { key: string; name: string; description?: string; permissions: string[] }, actorId: string) {
    const role = await this.prisma.db.role.create({ data: { ...input, isSystem: false } });
    await this.audit.log({ action: 'CREATE', entityType: 'Role', entityId: role.key, after: role, userId: actorId });
    return role;
  }
}
