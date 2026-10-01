import { Injectable } from '@nestjs/common';
import { PrismaService, Tx } from './prisma.service';
import { Prisma } from '@prisma/client';


/**
 * Form codes (owner request 2026-09-26): every form number reads BRANCH-FORM-NUMBER, e.g. WA-PO-000012 = West Ave Pull-Out no. 12,
 * MY-TI-000003 = Mayon Transfer-In no. 3. Each branch keeps its own running number per form.
 */
export const FORM_CODES = {
  PO: 'Pull-Out (stock sent out)', TI: 'Transfer-In (stock received from another location)', RC: "Receiving / Supplier's Form", DR: 'Delivery Receipt – Sales',
  EX: 'Expense', IC: 'Inventory Count sheet', DC: 'Discrepancy case', CF: 'Charge Form', WO: 'Write-off (expired / damaged)', CN: 'Credit Note (AR payment)',
  SI: 'Store Inspection Report', FR: 'Cash Fund Replenishment', PC: 'Price Change',
  EP: 'E-commerce Payout (settlement)', ER: 'E-commerce Return', RT: 'Replacement Ticket',
} as const;
export type FormCode = keyof typeof FORM_CODES;
/** Company-wide forms (no branch) use HO (Head Office). */
export const HEAD_OFFICE_CODE = 'HO';

/** Control numbers per document type (and per location where the paper forms do so). */
@Injectable()
export class SequenceService {
  constructor(private prisma: PrismaService) {}

  /** Next number for a form at a location: `${branch short code}-${form code}-${000001}`. */
  async form(tx: Tx, form: FormCode, locationId: string | null): Promise<string> {
    const br = locationId ? await this.shortCode(tx, locationId) : HEAD_OFFICE_CODE;
    // a number freed by a deleted draft is used first, so the numbers have no holes
    const freed = await tx.$queryRaw<{ no: number }[]>`
      DELETE FROM form_numbers_released WHERE id = (SELECT id FROM form_numbers_released WHERE doc_type = ${'F:' + form} AND scope_key = ${br} ORDER BY no LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING no`;
    if (freed.length) return SequenceService.format(br, form, Number(freed[0].no));
    const rows = await tx.$queryRaw<{ next_no: number }[]>`
      INSERT INTO control_sequences (id, doc_type, scope_key, year, next_no)
      VALUES (gen_random_uuid(), ${'F:' + form}, ${br}, 0, 2)
      ON CONFLICT (doc_type, scope_key, year) DO UPDATE SET next_no = control_sequences.next_no + 1
      RETURNING next_no - 1 AS next_no`;
    return `${br}-${form}-${String(Number(rows[0].next_no)).padStart(6, '0')}`;
  }

  static format(br: string, form: FormCode, n: number) { return `${br}-${form}-${String(n).padStart(6, '0')}`; }
  /** 12 from "WA-PO-000012". */
  static numberOf(no: string): number { const m = /-(\d+)$/.exec(no); return m ? Number(m[1]) : NaN; }

  /** A form number is given up (its draft was deleted): the counter steps back if it was the last one, otherwise the number waits to be reused by the next new form. */
  async release(tx: Tx, form: FormCode, br: string, n: number) {
    const key = 'F:' + form;
    const cur = await tx.$queryRaw<{ next_no: number }[]>`SELECT next_no FROM control_sequences WHERE doc_type = ${key} AND scope_key = ${br} AND year = 0 FOR UPDATE`;
    const next = cur.length ? Number(cur[0].next_no) : 1;
    if (n === next - 1) {
      let top = n - 1;
      // numbers freed earlier just below it close up as well
      while (top >= 1 && (await tx.formNumberReleased.deleteMany({ where: { docType: key, scopeKey: br, no: top } })).count) top--;
      await tx.$executeRaw`UPDATE control_sequences SET next_no = ${top + 1} WHERE doc_type = ${key} AND scope_key = ${br} AND year = 0`;
      await tx.formNumberReleased.deleteMany({ where: { docType: key, scopeKey: br, no: { gt: top } } }); // nothing freed can lie above the counter
    } else if (n < next) await tx.formNumberReleased.upsert({ where: { docType_scopeKey_no: { docType: key, scopeKey: br, no: n } }, create: { docType: key, scopeKey: br, no: n }, update: {} });
  }

  /**
   * A draft numbered `deletedNo` is gone. The drafts after it move down one number each (until the first form that is already submitted, whose number is fixed),
   * and the number left at the end is released. `rename` gives a draft its new number.
   */
  async closeGap(tx: Tx, form: FormCode, br: string, deletedNo: number, later: { id: string; no: number; draft: boolean }[], rename: (id: string, newNo: string) => Promise<void>) {
    const moved: { id: string; from: string; to: string }[] = []; let slot = deletedNo;
    for (const d of [...later].filter((x) => x.no > deletedNo).sort((a, b) => a.no - b.no)) {
      if (!d.draft) break;
      await rename(d.id, SequenceService.format(br, form, slot));
      moved.push({ id: d.id, from: SequenceService.format(br, form, d.no), to: SequenceService.format(br, form, slot) });
      slot = d.no;
    }
    await this.release(tx, form, br, slot);
    return moved;
  }

  /** The location's 2-letter code; a location without one gets a unique code from its name (saved so it never changes). */
  async shortCode(tx: Tx, locationId: string): Promise<string> {
    const loc = await tx.location.findUniqueOrThrow({ where: { id: locationId }, select: { shortCode: true, name: true, code: true } });
    if (loc.shortCode) return loc.shortCode;
    const taken = new Set((await tx.location.findMany({ where: { shortCode: { not: null } }, select: { shortCode: true } })).map((l) => l.shortCode!));
    taken.add(HEAD_OFFICE_CODE);
    const letters = (loc.name + loc.code).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const candidates = [letters.slice(0, 2), ...[...letters.slice(1)].map((c) => letters[0] + c), ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').flatMap((a) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('').map((b) => a + b))];
    const code = candidates.find((c) => c.length === 2 && !taken.has(c))!;
    await tx.location.update({ where: { id: locationId }, data: { shortCode: code } });
    return code;
  }

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
