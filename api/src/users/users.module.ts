import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { AuditLogController, RolesController, UsersController } from './users.controller';
import { HistoryController } from './history.controller';

@Module({ providers: [UsersService], controllers: [UsersController, RolesController, AuditLogController, HistoryController], exports: [UsersService] })
export class UsersModule {}
