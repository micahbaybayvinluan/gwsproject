/**
 * §5.3 Cost redaction — enforced in the API serialization layer, never only in the UI.
 * `redactForRole(dto, user)` walks any JSON-serialisable value and strips sensitive fields
 * the user is not permitted to see. Applied globally by RedactionInterceptor.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { PRICE_TIERS } from './permissions';

export interface RedactionUser {
  roleKey: string;
  permissions: Set<string> | string[];
}

/** Field names that carry cost/margin information anywhere in a payload. */
export const COST_FIELDS = new Set([
  'cost', 'unitCost', 'landedCost', 'originalUnitCost', 'batchCost', 'standardCost', 'costOld', 'costNew', 'totalCost', 'valueAtCost',
  'margin', 'marginPct', 'grossProfit', 'grossMargin', 'grossMarginPct', 'totalGain', 'gain', 'directCost', 'costOfSales', 'cogs',
  // Daily Inventory Report value buckets
  'begCost', 'endCost', 'receiveCost', 'transferInCost', 'returnsCost', 'pullOutCost', 'salesCost', 'otherCost', 'adjustCost',
]);
/** Field names that carry the supplier's real name. */
export const SUPPLIER_NAME_FIELDS = new Set(['supplierName']);
/** Keys under which a Supplier object appears. */
const SUPPLIER_OBJECT_KEYS = new Set(['supplier', 'consignor']);
/** Keys under which a per-tier price map appears ({RETAIL: 100, DEALER: 80}). */
const TIER_MAP_KEYS = new Set(['tierPrices', 'pricesByTier']);
/** Keys under which arrays of {tier, price} rows appear. */
const TIER_ARRAY_KEYS = new Set(['prices', 'priceHistory', 'priceLists']);

function has(user: RedactionUser, key: string): boolean {
  const p = user.permissions;
  return p instanceof Set ? p.has(key) : p.includes(key);
}

export function redactForRole<T>(value: T, user: RedactionUser | null | undefined): T {
  if (!user) return value;
  const canCost = has(user, 'cost.view');
  const canSupplierName = has(user, 'supplier.view.name');
  const tierAllowed = (tier: string) => has(user, `price.view.${tier}`);
  if (canCost && canSupplierName && hasAllTiers(user)) return value; // fast path: nothing to redact
  return walk(value, undefined, { canCost, canSupplierName, tierAllowed }) as T;
}

function hasAllTiers(user: RedactionUser) {
  // Only used as a fast-path hint; custom tiers still go through tierAllowed.
  return PRICE_TIERS.every((t) => has(user, `price.view.${t}`));
}

function isDecimalLike(v: unknown): boolean { return !!v && typeof v === 'object' && typeof (v as { toFixed?: unknown }).toFixed === 'function' && typeof (v as { toDecimalPlaces?: unknown }).toDecimalPlaces === 'function'; }

interface Ctx { canCost: boolean; canSupplierName: boolean; tierAllowed: (t: string) => boolean }

function walk(value: unknown, parentKey: string | undefined, ctx: Ctx): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    let arr = value.map((v) => walk(v, parentKey, ctx));
    if (parentKey && TIER_ARRAY_KEYS.has(parentKey)) {
      arr = arr.filter((row) => !(row && typeof row === 'object' && 'tier' in (row as object)) || ctx.tierAllowed(String((row as { tier: string }).tier)));
    }
    return arr;
  }
  if (typeof value !== 'object') return value;
  // Dates pass through; Decimal-like values (decimal.js / Prisma.Decimal) serialise as strings, matching JSON.stringify's toJSON output
  if (value instanceof Date) return value;
  if (isDecimalLike(value)) return (value as { toString(): string }).toString();

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!ctx.canCost && COST_FIELDS.has(k)) continue;
    if (!ctx.canSupplierName && SUPPLIER_NAME_FIELDS.has(k)) continue;
    if (!ctx.canSupplierName && SUPPLIER_OBJECT_KEYS.has(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      const { name: _dropped, ...rest } = v as Record<string, unknown>;
      out[k] = walk(rest, k, ctx);
      continue;
    }
    if (TIER_MAP_KEYS.has(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([tier]) => ctx.tierAllowed(tier)));
      continue;
    }
    // A single price row {tier, price} whose tier is not permitted → drop the price value
    if (k === 'tierPrice' || k === 'unitPrice') { out[k] = v; continue; }
    out[k] = walk(v, k, ctx);
  }
  if ('tier' in out && 'price' in out && typeof out.tier === 'string' && !ctx.tierAllowed(out.tier)) {
    delete out.price;
  }
  return out;
}

@Injectable()
export class RedactionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const user = req?.user as RedactionUser | undefined;
    return next.handle().pipe(map((data) => (Buffer.isBuffer(data) || typeof data === 'string' ? data : redactForRole(data, user))));
  }
}
