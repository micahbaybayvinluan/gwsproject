import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SessionStore } from '../auth/session.store';
import { PERMISSION_KEYS, ROLE_BY_KEY, SINGLE_LOCATION_ROLES } from '../common/permissions';

export interface CreateUserInput { username: string; email: string; fullName: string; idNumber: string; roleKey: string; password: string; locationIds?: string[] }

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private audit: AuditService, private sessions: SessionStore) {}

  private select = { id: true, username: true, email: true, fullName: true, idNumber: true, accountabilityAcceptedAt: true, active: true, mustChangePassword: true, totpEnabled: true, lastLoginAt: true, createdAt: true, role: { select: { key: true, name: true } }, assignments: { select: { location: { select: { id: true, code: true, name: true, type: true } } } }, permissionOverrides: { select: { permissionKey: true, granted: true } } } as const;

  list() { return this.prisma.db.user.findMany({ select: this.select, orderBy: { username: 'asc' } }); }
  async get(id: string) { const u = await this.prisma.db.user.findUnique({ where: { id }, select: this.select }); if (!u) throw new NotFoundException(); return u; }

  async create(input: CreateUserInput, actorId: string) {
    const role = await this.prisma.db.role.findUnique({ where: { key: input.roleKey } });
    if (!role) throw new BadRequestException('Unknown role');
    this.validateAssignments(input.roleKey, input.locationIds ?? []);
    const user = await this.prisma.db.user.create({
      data: {
        username: input.username, email: input.email.toLowerCase(), fullName: input.fullName, roleId: role.id,
        idNumber: input.idNumber, passwordHash: await argon2.hash(input.password), mustChangePassword: true, createdBy: actorId,
        assignments: { create: (input.locationIds ?? []).map((locationId) => ({ locationId })) },
      },
      select: this.select,
    });
    await this.audit.log({ action: 'CREATE', entityType: 'User', entityId: user.id, after: user });
    return user;
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

  private validateAssignments(roleKey: string, locationIds: string[]) {
    if (SINGLE_LOCATION_ROLES.includes(roleKey as never) && locationIds.length !== 1) {
      throw new BadRequestException(`${ROLE_BY_KEY[roleKey]?.name ?? roleKey} must be assigned exactly one location`);
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
