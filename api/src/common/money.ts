import Decimal from 'decimal.js';

export type Money = Decimal;
export const D = (v: Decimal.Value | null | undefined): Decimal => new Decimal(v ?? 0);
export const ZERO = new Decimal(0);
export const round2 = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
export const sum = (vals: Iterable<Decimal.Value>) => { let t = ZERO; for (const v of vals) t = t.plus(v ?? 0); return t; };
export const toNum = (v: Decimal.Value | null | undefined) => round2(D(v)).toNumber();
export const money = (v: Decimal.Value | null | undefined) => round2(D(v)).toFixed(2);
