import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { AuditLogController, HrAccountsController, RolesController, UsersController } from './users.controller';
import { HistoryController } from './history.controller';

@Module({ providers: [UsersService], controllers: [UsersController, HrAccountsController, RolesController, AuditLogController, HistoryController], exports: [UsersService] })
export class UsersModule {}
