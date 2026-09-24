import { ForbiddenException, Injectable } from '@nestjs/common';
import type { SessionUser } from './request-context';

/** §5.4 data scoping helpers. */
@Injectable()
export class ScopeService {
  /** Prisma `where` fragment for a location id field. Returns {} for all-scope roles. */
  where(user: SessionUser, field = 'locationId'): Record<string, unknown> {
    if (!user.locationScoped) return { [field]: { not: '' } }; // always-true filter satisfies mandatory-scope guard uniformly
    return { [field]: { in: user.locationIds } };
  }
  /** Filter for TransferDoc: from OR to within scope. */
  whereTransfer(user: SessionUser): Record<string, unknown> {
    if (!user.locationScoped) return { OR: [{ fromLocationId: { not: '' } }] };
    return { OR: [{ fromLocationId: { in: user.locationIds } }, { toLocationId: { in: user.locationIds } }] };
  }
  /** Throw unless the user may act on this location. */
  assertLocation(user: SessionUser, locationId: string) {
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException('Location outside your assignment');
  }
  /** Resolve a requested location id or default to the user's single assignment. */
  resolveLocation(user: SessionUser, requested?: string | null): string {
    if (requested) { this.assertLocation(user, requested); return requested; }
    if (user.locationIds.length === 1) return user.locationIds[0];
    throw new ForbiddenException('locationId is required');
  }
}
