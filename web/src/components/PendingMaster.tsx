import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface PendingResult { pending?: boolean; approvalRequestId?: string; message?: string }
/** Message to show after a create: new master data from anyone but the Owner waits for the Owner's approval. */
export const pendingMessage = (r: unknown) => ((r as PendingResult)?.pending ? (r as PendingResult).message ?? 'Sent to the Owner for approval.' : '');

/** New items of this kind that are still waiting for the Owner (names only). */
export function PendingMaster({ kind, label }: { kind: string; label: string }) {
  const q = useQuery({ queryKey: ['master-pending', kind], queryFn: () => api.get<{ approvalRequestId: string; name: string; requestedByName: string; createdAt: string }[]>(`/api/master-data/pending?kind=${kind}`) });
  if (!q.data?.length) return null;
  return <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm" data-testid={`pending-${kind}`}>
    <div className="font-medium text-amber-900">{label} waiting for the Owner's approval ({q.data.length})</div>
    <ul className="mt-1 list-disc pl-5 text-amber-900">{q.data.map((p) => <li key={p.approvalRequestId}>{p.name} <span className="text-xs text-amber-700">— by {p.requestedByName}, {new Date(p.createdAt).toLocaleDateString()}</span></li>)}</ul>
  </div>;
}
