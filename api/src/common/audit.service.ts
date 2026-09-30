import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { PrismaService } from './prisma.service';
import { requestContext } from './request-context';
import { AUDIT_KEY } from './decorators';

export interface AuditEntry { action: string; entityType: string; entityId?: string | null; before?: unknown; after?: unknown; userId?: string | null }

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}
  async log(entry: AuditEntry) {
    const ctx = requestContext.get();
    await this.prisma.db.auditLog.create({
      data: {
        userId: entry.userId ?? ctx?.user?.id ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: entry.before === undefined ? undefined : (JSON.parse(JSON.stringify(entry.before)) as object),
        after: entry.after === undefined ? undefined : (JSON.parse(JSON.stringify(entry.after)) as object),
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
      },
    });
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** §3 rule 3: every state-changing request writes an audit_log row. Services may add richer before/after rows themselves. */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private audit: AuditService, private reflector: Reflector) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    if (!MUTATING.has(req.method) || req.path?.startsWith('/api/auth/login')) return next.handle();
    const meta = this.reflector.get<{ entityType: string; action?: string } | undefined>(AUDIT_KEY, context.getHandler());
    const entityType = meta?.entityType ?? ((req.path as string).split('/').filter(Boolean).slice(1, 2).join('') || 'http');
    const action = meta?.action ?? `${req.method} ${req.route?.path ?? req.path}`;
    const body = sanitize(req.body);
    return next.handle().pipe(
      tap({
        next: (result) => {
          const r = result as { id?: string } | undefined;
          void this.audit.log({ action, entityType, entityId: r?.id ?? req.params?.id ?? null, before: undefined, after: { request: body, resultId: r?.id } }).catch(() => undefined);
        },
      }),
    );
  }
}

function sanitize(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const clone = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  for (const k of Object.keys(clone)) if (/password|secret|totp|token/i.test(k)) clone[k] = '***';
  return clone;
}
