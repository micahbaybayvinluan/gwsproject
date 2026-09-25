import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { SessionStore } from './session.store';
import { PERMISSION_KEY, PUBLIC_KEY } from '../common/decorators';
import { NO_OPS_ROLES } from '../common/permissions';
import { requestContext } from '../common/request-context';

export const COOKIE = process.env.SESSION_COOKIE || 'gws_sid';

/** Authenticates the session cookie (or Bearer token), enforces 2FA completion, then checks @RequirePermission. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private auth: AuthService, private reflector: Reflector, private sessions: SessionStore) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    const req = context.switchToHttp().getRequest<Request & { user?: unknown; sessionId?: string }>();
    const sid = (req.cookies?.[COOKIE] as string | undefined) ?? bearer(req.headers.authorization);
    if (sid) {
      const user = await this.auth.resolve(sid);
      if (user) {
        req.user = user;
        req.sessionId = sid;
        const ctx = requestContext.get();
        if (ctx) ctx.user = user;
      }
    }
    if (isPublic) return true;
    const user = req.user as import('../common/request-context').SessionUser | undefined;
    if (!user) {
      if (sid && (await this.sessions.wasReplaced(sid))) throw new UnauthorizedException({ message: 'You were signed out because your account signed in on another device', code: 'SESSION_REPLACED' });
      throw new UnauthorizedException('Not signed in');
    }
    const path = req.path;
    const totpExempt = path.startsWith('/api/auth/');
    if (!user.totpVerified && !totpExempt) throw new UnauthorizedException({ message: 'Two-factor verification required', code: 'TOTP_REQUIRED' });
    // Personal accounts: replace a temporary password and accept the accountability statement before doing anything else.
    if (!totpExempt && user.mustChangePassword) throw new ForbiddenException({ message: 'Set your own password first', code: 'PASSWORD_CHANGE_REQUIRED' });
    if (!totpExempt && !user.accountabilityAccepted) throw new ForbiddenException({ message: 'Accept the account accountability statement first', code: 'ACCOUNTABILITY_REQUIRED' });

    // §5.4 HR_STAFF: every inventory/sales route returns 403
    if (NO_OPS_ROLES.includes(user.roleKey as never) && /^\/api\/(sales|stock|products|receiving|transfers|counts|reports|ar|expenses|batches|consignment)/.test(path)) {
      throw new ForbiddenException('This role has no access to inventory or sales');
    }

    const required = this.reflector.getAllAndOverride<string[] | { anyOf: string[] } | undefined>(PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (!required) return true;
    if (Array.isArray(required)) {
      const missing = required.filter((k) => !user.permissions.has(k));
      if (missing.length) throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
      return true;
    }
    if (!required.anyOf.some((k) => user.permissions.has(k))) throw new ForbiddenException(`Requires one of: ${required.anyOf.join(', ')}`);
    return true;
  }
}

function bearer(h?: string) { return h?.startsWith('Bearer ') ? h.slice(7) : undefined; }
