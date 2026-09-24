import { Injectable } from '@nestjs/common';
import { PrismaService, Tx } from './prisma.service';
import { Prisma } from '@prisma/client';


/** Control numbers per document type (and per location where the paper forms do so). */
@Injectable()
export class SequenceService {
  constructor(private prisma: PrismaService) {}

  async next(tx: Tx, docType: string, opts: { locationId?: string | null; locationCode?: string; year?: number | null; prefix?: string; pad?: number } = {}): Promise<string> {
    const scopeKey = opts.locationId ?? '';
    const year = opts.year ?? 0;
    // upsert-then-increment under row lock (all key columns NOT NULL so ON CONFLICT always matches)
    const rows = await tx.$queryRaw<{ next_no: number }[]>`
      INSERT INTO control_sequences (id, doc_type, scope_key, year, next_no)
      VALUES (gen_random_uuid(), ${docType}, ${scopeKey}, ${year}, 2)
      ON CONFLICT (doc_type, scope_key, year) DO UPDATE SET next_no = control_sequences.next_no + 1
      RETURNING next_no - 1 AS next_no`;
    const n = Number(rows[0].next_no);
    const prefix = opts.prefix ?? docType;
    const parts = [prefix];
    if (opts.locationCode) parts.push(opts.locationCode);
    if (year) parts.push(String(year));
    parts.push(String(n).padStart(opts.pad ?? 6, '0'));
    return parts.join('-');
  }
}
