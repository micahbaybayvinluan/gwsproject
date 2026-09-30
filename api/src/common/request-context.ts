import { AsyncLocalStorage } from 'node:async_hooks';

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  roleKey: string;
  permissions: Set<string>;
  locationIds: string[];
  /** true for roles listed in LOCATION_SCOPED_ROLES → mandatory location filter */
  locationScoped: boolean;
  sessionId: string;
  totpVerified: boolean;
  /** Personal-account gates: a temporary password must be replaced and the accountability statement accepted before any work. */
  mustChangePassword?: boolean;
  accountabilityAccepted?: boolean;
}
export interface RequestCtx { user?: SessionUser; ip?: string; userAgent?: string; requestId: string }

class RequestContextStore {
  private als = new AsyncLocalStorage<RequestCtx>();
  run<T>(ctx: RequestCtx, fn: () => T): T { return this.als.run(ctx, fn); }
  get(): RequestCtx | undefined { return this.als.getStore(); }
  /** For jobs and tests: run with no user (unscoped). */
  runSystem<T>(fn: () => T): T { return this.als.run({ requestId: 'system' }, fn); }
}
export const requestContext = new RequestContextStore();
