/** Proof of payment: the kinds, their short codes and the legend printed with the reports (owner request 2026-10-09). */
export type ProofKind = 'ONLINE' | 'CARD' | 'CHEQUE' | 'COLLECTION' | 'REPLACEMENT' | 'DEPOSIT' | 'FRANCHISE';
export const PROOF_KINDS: { kind: ProofKind; code: string; label: string; what: string; color: string }[] = [
  { kind: 'ONLINE', code: 'ON', label: 'Online sale', what: 'Screenshot of the bank / GCash payment', color: '#0369a1' },
  { kind: 'CARD', code: 'CC', label: 'Card sale', what: 'Photo of the card terminal slip', color: '#7c3aed' },
  { kind: 'CHEQUE', code: 'CQ', label: 'Cheque', what: 'Photo of the cheque (sale or collection)', color: '#b45309' },
  { kind: 'COLLECTION', code: 'AR', label: 'AR collection', what: 'Proof of an online / card collection on an invoice', color: '#0f766e' },
  { kind: 'REPLACEMENT', code: 'RP', label: 'Replacement payment', what: 'Proof of the price difference paid or refunded', color: '#be123c' },
  { kind: 'DEPOSIT', code: 'DS', label: 'Bank deposit slip', what: 'The bank deposit slip of the day', color: '#15803d' },
  { kind: 'FRANCHISE', code: 'FR', label: 'Franchise payment', what: 'Transfer screenshot, GCash receipt or cheque photo', color: '#4338ca' },
];
export const proofMeta = (k: ProofKind) => PROOF_KINDS.find((x) => x.kind === k)!;

export interface ProofItem {
  ref: string; kind: ProofKind; kindLabel: string; docNo: string; party: string | null; mode: string; account: string | null; reference: string | null;
  amount: number; date: string; branch: string; locationId: string | null;
  attachmentId: string | null; fileName: string | null; contentType: string | null; missing: boolean; /** what the payment belongs to, for linking back */ docType: string; docId: string;
}
