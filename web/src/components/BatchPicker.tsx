import { api } from '@/lib/api';
import { Badge, Button } from '@/components/ui/primitives';

/** One batch of a product at a location: its flavor, expiry and how many are on hand (owner request 2026-09-30). */
export interface BatchOpt { batchId: string; batchNo: string | null; expiryDate: string | null; flavor: string | null; qty: number; expired?: boolean }

export const batchText = (b: { flavor?: string | null; expiryDate?: string | null; batchNo?: string | null }) =>
  [b.flavor, b.expiryDate ? `exp ${String(b.expiryDate).slice(0, 10)}` : 'no expiry', b.batchNo ? `batch ${b.batchNo}` : null].filter(Boolean).join(' · ');

/** Batches of a product at a location, earliest expiry first (expired ones last unless asked for). */
export async function loadBatches(productId: string, locationId: string, includeExpired = false) {
  const rows = await api.get<BatchOpt[]>(`/api/stock/batches/${productId}?locationId=${locationId}`);
  return rows.filter((b) => b.qty > 0 && (includeExpired || !b.expired));
}

const daysLeft = (d: string | null) => (d ? Math.round((new Date(`${String(d).slice(0, 10)}T00:00:00Z`).getTime() - Date.now()) / 864e5) : null);

/** The choice shown when a SKU has more than one flavor or expiry at the location: pick the one being sold or moved. */
export function BatchChooser({ name, batches, onPick, onCancel }: { name: string; batches: BatchOpt[]; onPick: (b: BatchOpt) => void; onCancel: () => void }) {
  return <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3" data-testid="batch-chooser">
    <div className="mb-2 flex items-center justify-between gap-2"><div className="text-sm font-semibold text-navy">Choose the flavor / expiry of <span className="font-bold">{name}</span></div><button type="button" className="text-xs text-slate-500 hover:underline" onClick={onCancel}>Cancel</button></div>
    <ul className="divide-y divide-amber-200 rounded-md border border-amber-200 bg-white">
      {batches.map((b, i) => { const d = daysLeft(b.expiryDate); return <li key={b.batchId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
        {b.flavor ? <Badge tone="purple">{b.flavor}</Badge> : <span className="text-xs text-slate-400">no flavor set</span>}
        <span className="font-medium">{b.expiryDate ? `Exp ${String(b.expiryDate).slice(0, 10)}` : 'No expiry'}</span>
        {d != null && <span className={`text-xs ${b.expired ? 'text-red-700' : d <= 90 ? 'text-amber-700' : 'text-slate-500'}`}>{b.expired ? 'expired' : `${d} days left`}</span>}
        {b.batchNo && <span className="text-xs text-slate-500">batch {b.batchNo}</span>}
        {i === 0 && !b.expired && <Badge tone="green">oldest · first out</Badge>}
        <span className="ml-auto text-xs text-slate-600"><b>{b.qty}</b> on hand</span>
        <Button size="sm" onClick={() => onPick(b)}>Add</Button>
      </li>; })}
    </ul>
  </div>;
}
