import type { PrismaClient } from '@prisma/client';

/** What a franchise pays for a plastic bag (owner request 2026-10-01). For stores and other customers a plastic is free unless it is sold (price typed on the sale). The Admin edits these in Price Changes. */
export const PLASTIC_FRANCHISE_PRICES = { S: 3, M: 3, L: 4, XL: 5 } as const;
export type PlasticSize = keyof typeof PLASTIC_FRANCHISE_PRICES;

/** "Plastic XL", "Plastic L", "Plastic Medium", "Plastic Ecobag Large" → the size; anything that is not a sized plastic bag → null (shakers and bottles are not bags). */
export function plasticSize(name: string): PlasticSize | null {
  const n = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  if (!/\b(plastic|ecobag|eco bag)\b/.test(n)) return null;
  if (/ (xl|xlarge|extra large) /.test(n)) return 'XL';
  if (/ (l|large) /.test(n)) return 'L';
  if (/ (m|medium|med) /.test(n)) return 'M';
  if (/ (s|small) /.test(n)) return 'S';
  return null;
}

/** Gives each sized plastic bag its franchise price, only where the product has no franchise price yet (a price the Admin set is never overwritten). */
export async function ensurePlasticFranchisePrices(prisma: PrismaClient): Promise<number> {
  const products = await prisma.product.findMany({ where: { category: { accountingClass: 'PLASTIC' } }, select: { id: true, name: true } });
  let n = 0;
  for (const p of products) {
    const size = plasticSize(p.name); if (!size) continue;
    if (await prisma.priceList.findFirst({ where: { productId: p.id, tier: 'FRANCHISE' }, select: { id: true } })) continue;
    await prisma.priceList.create({ data: { productId: p.id, tier: 'FRANCHISE', effectiveFrom: new Date('2026-01-01T00:00:00Z'), price: PLASTIC_FRANCHISE_PRICES[size].toFixed(2) } });
    n++;
  }
  return n;
}
