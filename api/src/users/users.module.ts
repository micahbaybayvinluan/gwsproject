import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { AuditLogController, RolesController, UsersController } from './users.controller';

@Module({ providers: [UsersService], controllers: [UsersController, RolesController, AuditLogController], exports: [UsersService] })
export class UsersModule {}
