/**
 * Restock planner (owner request 2026-10-08). Pure: from the stock and the average daily sales of every branch (and the warehouse) for ONE item it works out
 *  1. what each branch needs to hold `coverDays` of stock,
 *  2. what can be moved to it from EXISTING stock first (the warehouse's stock above its own reserve, else the branch with the most surplus),
 *  3. what is left to order (the branches' remaining needs plus what the warehouse itself lacks), less what is already on order.
 * Everything here is only a suggestion: the Head Auditor and the Owner can change every number.
 */
export interface PlanLoc { id: string; type: 'WAREHOUSE' | 'BRANCH'; onHand: number; avgPerDay: number }
export interface PlanOpts { coverDays: number; reserveDays: number; surplusDays: number; onOrder: number }
export interface PlanRow { locationId: string; onHand: number; avgPerDay: number; daysLeft: number | null; need: number; transferQty: number; transferFromId: string | null; allocQty: number }
export interface Plan { rows: PlanRow[]; warehouse: { id: string | null; onHand: number; avgPerDay: number; daysLeft: number | null; giveable: number; transferredOut: number; shortfall: number }; grossOrder: number; suggestedOrder: number }

const days = (onHand: number, avg: number) => (avg > 0 ? Math.round((onHand / avg) * 10) / 10 : null);

export function planProduct(locs: PlanLoc[], o: PlanOpts): Plan {
  const wh = locs.find((l) => l.type === 'WAREHOUSE') ?? null;
  const branches = locs.filter((l) => l.type === 'BRANCH');
  const surplus = new Map(branches.map((b) => [b.id, b.avgPerDay > 0 ? Math.max(0, b.onHand - Math.ceil(b.avgPerDay * o.surplusDays)) : 0]));
  let whPool = wh ? Math.max(0, wh.onHand - Math.ceil(wh.avgPerDay * o.reserveDays)) : 0; const giveable = whPool; let outFromWh = 0;
  const rows: PlanRow[] = branches.map((b) => ({ locationId: b.id, onHand: b.onHand, avgPerDay: b.avgPerDay, daysLeft: days(b.onHand, b.avgPerDay), need: b.avgPerDay > 0 ? Math.max(0, Math.ceil(b.avgPerDay * o.coverDays) - b.onHand) : 0, transferQty: 0, transferFromId: null, allocQty: 0 }));
  // most critical first (fewest days left); items with no sales have no need
  for (const r of [...rows].sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity))) {
    if (r.need <= 0) continue;
    if (whPool > 0 && wh) { const t = Math.min(r.need, whPool); whPool -= t; outFromWh += t; r.transferQty = t; r.transferFromId = wh.id; }
    else {
      const donor = [...surplus.entries()].filter(([id, v]) => id !== r.locationId && v > 0).sort((a, b) => b[1] - a[1])[0];
      if (donor) { const t = Math.min(r.need, donor[1]); surplus.set(donor[0], donor[1] - t); r.transferQty = t; r.transferFromId = donor[0]; }
    }
    r.allocQty = r.need - r.transferQty;
  }
  const whTarget = wh ? Math.ceil(wh.avgPerDay * o.coverDays) : 0;
  const shortfall = wh ? Math.max(0, whTarget - (wh.onHand - outFromWh)) : 0;
  const gross = rows.reduce((t, r) => t + r.allocQty, 0) + shortfall;
  return { rows, warehouse: { id: wh?.id ?? null, onHand: wh?.onHand ?? 0, avgPerDay: wh?.avgPerDay ?? 0, daysLeft: wh ? days(wh.onHand - outFromWh, wh.avgPerDay) : null, giveable, transferredOut: outFromWh, shortfall }, grossOrder: gross, suggestedOrder: Math.max(0, gross - o.onOrder) };
}
