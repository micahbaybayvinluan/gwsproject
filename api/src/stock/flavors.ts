import type { Tx } from '../common/prisma.service';

/** Adds a flavor to the SKU's flavor list when it is new (owner request 2026-09-30); case and spacing do not make a new flavor. */
export async function addFlavor(tx: Tx, productId: string, flavor: string) {
  const name = flavor.trim().replace(/\s+/g, ' ');
  if (!name) return;
  const p = await tx.product.findUnique({ where: { id: productId }, select: { flavors: true } });
  if (p && !p.flavors.some((f) => f.toLowerCase() === name.toLowerCase())) await tx.product.update({ where: { id: productId }, data: { flavors: { push: name } } });
}

/** "Choco · exp 2027-03-31 · batch B12" — how a batch is named on screens and forms. */
export function batchLabel(b: { flavor?: string | null; expiryDate?: Date | string | null; batchNo?: string | null }) {
  const exp = b.expiryDate ? (typeof b.expiryDate === 'string' ? b.expiryDate.slice(0, 10) : b.expiryDate.toISOString().slice(0, 10)) : null;
  return [b.flavor, exp ? `exp ${exp}` : 'no expiry', b.batchNo ? `batch ${b.batchNo}` : null].filter(Boolean).join(' · ');
}
