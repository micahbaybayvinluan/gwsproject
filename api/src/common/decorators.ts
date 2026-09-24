import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { SessionUser } from './request-context';

export const PERMISSION_KEY = 'gws:permissions';
export const PUBLIC_KEY = 'gws:public';
export const AUDIT_KEY = 'gws:audit';

/** Require ALL listed permission keys. */
export const RequirePermission = (...keys: string[]) => SetMetadata(PERMISSION_KEY, keys);
/** Require ANY of the listed permission keys. */
export const RequireAnyPermission = (...keys: string[]) => SetMetadata(PERMISSION_KEY, { anyOf: keys });
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Mark a handler as state-changing for the audit interceptor: entity type + optional action. */
export const Audited = (entityType: string, action?: string) => SetMetadata(AUDIT_KEY, { entityType, action });

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): SessionUser => ctx.switchToHttp().getRequest().user);
