import { api, peso } from '@/lib/api';
import { Photo } from '@/components/Photo';

export interface ProofItem { ref: string; kind: string; kindLabel: string; docNo: string; party: string | null; mode: string; account: string | null; reference: string | null; amount: number; date: string; branch: string; attachmentId: string | null; fileName: string | null; contentType: string | null; missing: boolean }
export interface ProofKindInfo { kind: string; code: string; label: string; color: string; count: number; missing: number; amount: number }

/** The same colours and codes the printed report uses, so a person reading the screen and the paper sees the same legend. */
export const PROOF_COLOR: Record<string, string> = { ONLINE: '#0369a1', CARD: '#7c3aed', CHEQUE: '#b45309', COLLECTION: '#0f766e', REPLACEMENT: '#be123c', DEPOSIT: '#15803d', FRANCHISE: '#4338ca' };
export const PROOF_KIND_LABEL: Record<string, string> = { ONLINE: 'Online sale', CARD: 'Card sale', CHEQUE: 'Cheque', COLLECTION: 'AR collection', REPLACEMENT: 'Replacement payment', DEPOSIT: 'Bank deposit slip', FRANCHISE: 'Franchise payment' };
export const PROOF_CODE: Record<string, string> = { ONLINE: 'ON', CARD: 'CC', CHEQUE: 'CQ', COLLECTION: 'AR', REPLACEMENT: 'RP', DEPOSIT: 'DS', FRANCHISE: 'FR' };

export function RefBadge({ item }: { item: Pick<ProofItem, 'ref' | 'kind' | 'missing'> }) {
  return <span className="inline-block rounded px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ background: item.missing ? '#b91c1c' : PROOF_COLOR[item.kind] }}>{item.ref}{item.missing ? ' ✗' : ''}</span>;
}

export function ProofLegend({ kinds }: { kinds: string[] }) {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600"><b>Legend:</b>{kinds.map((k) => <span key={k}><span className="mr-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ background: PROOF_COLOR[k] }}>{PROOF_CODE[k]}</span>{PROOF_KIND_LABEL[k]}</span>)}<span><span className="mr-1 inline-block rounded bg-red-700 px-1.5 py-0.5 text-[11px] font-bold text-white">✗</span>proof not uploaded</span></div>;
}

/** Every proof beside its transaction: the picture (tap to enlarge), the amount, the customer and the account, so Accounting can check fast. */
export function ProofCards({ items }: { items: ProofItem[] }) {
  if (!items.length) return <p className="text-sm text-slate-500">No online, card, cheque, collection, replacement or deposit payments in this period.</p>;
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map((i) => <div key={`${i.ref}-${i.docNo}`} className={`overflow-hidden rounded-xl border ${i.missing ? 'border-red-300' : 'border-slate-200'} bg-white`}>
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-white" style={{ background: i.missing ? '#b91c1c' : PROOF_COLOR[i.kind] }}><span>{i.ref}</span><span className="min-w-0 flex-1 truncate font-semibold">{i.kindLabel} · {i.docNo}</span><span>{peso(i.amount)}</span></div>
    <div className="bg-slate-50 px-3 py-1 text-xs text-slate-600">{[i.party, i.mode, i.account, i.reference, i.date, i.branch].filter(Boolean).join(' · ')}</div>
    <div className="flex min-h-28 items-center justify-center p-2">
      {i.missing ? <span className="font-bold text-red-700">NO PROOF UPLOADED</span>
        : i.contentType?.startsWith('image/') ? <Photo id={i.attachmentId} className="max-h-60 w-full object-contain" caption={`${i.ref} ${i.docNo}`} />
          : <button className="text-sm font-semibold text-brand underline" onClick={() => api.download(`/api/attachments/file/${i.attachmentId}`, i.fileName ?? 'proof')}>Open {i.fileName}</button>}
    </div>
  </div>)}</div>;
}
