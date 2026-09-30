import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { AccountResolver, Entry, MissingAccountError } from './posting-rules';
import { AccountsService } from './accounts.service';


/**
 * Persists auto journal vouchers. Enabled by setting `gl.auto_posting_enabled` (Phase 2 switch).
 * When disabled, Phase 1 documents still record every value Phase 2 needs; `replay()` can post them later.
 */
@Injectable()
export class PostingService {
  private log = new Logger('Posting');
  constructor(private prisma: PrismaService, private settings: SettingsService, private accounts: AccountsService) {}

  async enabled() { return !!(await this.settings.get<boolean>('gl.auto_posting_enabled')); }
  resolver(tx: Tx | null = null): Promise<AccountResolver> { return this.accounts.resolver(tx); }

  /** Build entries with `build(resolver)` and persist them for the source document. Never throws for a missing account: logs and skips (recorded in audit). */
  async post(tx: Tx, source: { type: string; id: string; date: Date; name?: string | null; createdBy?: string | null }, build: (r: AccountResolver) => Entry[] | Promise<Entry[]>) {
    if (!(await this.enabled())) return [];
    let entries: Entry[];
    try { entries = await build(await this.resolver(tx)); }
    catch (e) {
      if (e instanceof MissingAccountError) { this.log.warn(`Skipped posting for ${source.type} ${source.id}: ${e.message}`); await tx.auditLog.create({ data: { action: 'POSTING_SKIPPED', entityType: source.type, entityId: source.id, after: { reason: e.message } } }); return []; }
      throw e;
    }
    await this.assertPeriodOpen(tx, source.date);
    const out = [];
    for (const e of entries) out.push(await this.persist(tx, e, source));
    return out;
  }

  async persist(tx: Tx, e: Entry, source: { type: string; id: string; date: Date; name?: string | null; createdBy?: string | null }, prefix: 'A' | 'M' = 'A') {
    const voucherNo = await this.nextVoucherNo(tx, prefix, source.date.getUTCFullYear());
    return tx.journalVoucher.create({
      data: {
        voucherNo, date: source.date, book: e.book, remarks: e.remarks, name: source.name ?? e.name ?? null, reference: `${source.type}:${source.id}`,
        sourceDocumentType: source.type, sourceDocumentId: source.id, rule: e.rule, createdBy: source.createdBy ?? null,
        lines: { create: e.lines.map((l, i) => ({ lineNo: i + 1, accountId: l.accountId, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2), memo: l.memo })) },
      },
      include: { lines: true },
    });
  }

  async nextVoucherNo(tx: Tx, prefix: string, year: number) {
    const rows = await tx.$queryRaw<{ next_no: number }[]>`
      INSERT INTO voucher_sequences (id, prefix, year, next_no) VALUES (gen_random_uuid(), ${prefix}, ${year}, 2)
      ON CONFLICT (prefix, year) DO UPDATE SET next_no = voucher_sequences.next_no + 1 RETURNING next_no - 1 AS next_no`;
    return `${prefix}-${year}-${String(Number(rows[0].next_no)).padStart(6, '0')}`;
  }

  /** §10.3 period lock: no document dated in a locked month may be posted/edited/voided. */
  async assertPeriodOpen(tx: Tx | null, date: Date) {
    const db = (tx ?? this.prisma.db) as Tx;
    const p = await db.accountingPeriod.findUnique({ where: { year_month: { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 } } });
    if (p?.locked) throw new BadRequestException(`Accounting period ${p.year}-${String(p.month).padStart(2, '0')} is locked; post a reversal in an open month instead`);
  }
}
