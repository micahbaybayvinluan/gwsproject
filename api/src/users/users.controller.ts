import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { UsersService } from './users.service';
import { CurrentUser, RequirePermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { PrismaService } from '../common/prisma.service';

// Accounts are personal: every new account names its person (full name + company ID) and starts with a temporary password the person must replace.
const CreateUser = z.object({ username: z.string().min(3), email: z.string().email(), fullName: z.string().min(3), idNumber: z.string().trim().min(1, 'Company ID number of the person is required'), roleKey: z.string(), password: z.string().min(10), locationIds: z.array(z.string().uuid()).optional() });
const UpdateUser = z.object({ fullName: z.string().optional(), idNumber: z.string().trim().min(1).optional(), email: z.string().email().optional(), roleKey: z.string().optional(), active: z.boolean().optional(), locationIds: z.array(z.string().uuid()).optional(), resetPassword: z.string().min(10).optional(), resetTotp: z.boolean().optional() });
const Overrides = z.object({ overrides: z.array(z.object({ permissionKey: z.string(), granted: z.boolean() })) });
const RolePatch = z.object({ name: z.string().optional(), description: z.string().optional(), permissions: z.array(z.string()).optional() });
const RoleCreate = z.object({ key: z.string().regex(/^[A-Z_]+$/), name: z.string(), description: z.string().optional(), permissions: z.array(z.string()) });

@Controller('api/users')
@RequirePermission('user.manage')
export class UsersController {
  constructor(private users: UsersService) {}
  @Get() list() { return this.users.list(); }
  @Get('permission-keys') keys() { return this.users.permissionKeys(); }
  @Get(':id') get(@Param('id') id: string) { return this.users.get(id); }
  @Get(':id/logins') logins(@Param('id') id: string) { return this.users.logins(id); }
  @Post() @Audited('User', 'CREATE') create(@Body(Z(CreateUser)) dto: z.infer<typeof CreateUser>, @CurrentUser() u: SessionUser) { return this.users.create(dto, u.id); }
  @Patch(':id') @Audited('User', 'UPDATE') update(@Param('id') id: string, @Body(Z(UpdateUser)) dto: z.infer<typeof UpdateUser>, @CurrentUser() u: SessionUser) { return this.users.update(id, dto, u.id); }
  @Put(':id/overrides') @Audited('User', 'PERMISSION_CHANGE') overrides(@Param('id') id: string, @Body(Z(Overrides)) dto: z.infer<typeof Overrides>, @CurrentUser() u: SessionUser) { return this.users.setOverrides(id, dto.overrides, u.id); }
}

@Controller('api/roles')
export class RolesController {
  constructor(private users: UsersService) {}
  @Get() @RequirePermission('user.manage') roles() { return this.users.roles(); }
  @Patch(':key') @RequirePermission('role.manage') @Audited('Role') update(@Param('key') key: string, @Body(Z(RolePatch)) dto: z.infer<typeof RolePatch>) { return this.users.updateRole(key, dto); }
  @Post() @RequirePermission('role.manage') @Audited('Role', 'CREATE') create(@Body(Z(RoleCreate)) dto: z.infer<typeof RoleCreate>, @CurrentUser() u: SessionUser) { return this.users.createCustomRole(dto, u.id); }
}

@Controller('api/audit-log')
export class AuditLogController {
  constructor(private prisma: PrismaService) {}
  @Get() @RequirePermission('audit_log.view')
  list(@Query('userId') userId?: string, @Query('entityType') entityType?: string, @Query('entityId') entityId?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('take') take = '200') {
    return this.prisma.db.auditLog.findMany({
      where: { userId: userId || undefined, entityType: entityType || undefined, entityId: entityId || undefined, at: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } },
      include: { user: { select: { username: true, fullName: true, idNumber: true, role: { select: { name: true } } } } }, orderBy: { at: 'desc' }, take: Math.min(Number(take) || 200, 1000),
    });
  }
}
