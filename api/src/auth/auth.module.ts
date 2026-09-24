import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SessionStore } from './session.store';
import { AuthGuard } from './auth.guard';

@Global()
@Module({ providers: [AuthService, SessionStore, AuthGuard], controllers: [AuthController], exports: [AuthService, SessionStore, AuthGuard] })
export class AuthModule {}
