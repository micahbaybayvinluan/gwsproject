import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** Control numbers per document type (and per location where the paper forms do so). */
@Injectable()
export class SequenceService {
  constructor(private prisma: PrismaService) {}

  async next(tx: Tx, docType: string, opts: { locationId?: string | null; locationCode?: string; year?: number | null; prefix?: string; pad?: number } = {}): Promise<string> {
    const locationId = opts.locationId ?? null;
    const year = opts.year ?? null;
    // upsert-then-increment under row lock
    const rows = await tx.$queryRaw<{ next_no: number }[]>`
      INSERT INTO control_sequences (id, doc_type, location_id, year, next_no)
      VALUES (gen_random_uuid(), ${docType}, ${locationId}, ${year}, 2)
      ON CONFLICT (doc_type, location_id, year) DO UPDATE SET next_no = control_sequences.next_no + 1
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
