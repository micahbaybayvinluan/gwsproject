import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { FranchiseArService, type Rules } from './franchise-ar.service';

const rules: Rules = { termsDays: 30, penaltyPct: 2, dailyPct: 0.1, effectiveFrom: '2026-08-01', flagDays: 60, remindDaysBefore: 3 };
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const inv = (o: Partial<Prisma.FranchiseInvoiceGetPayload<object>> = {}): Prisma.FranchiseInvoiceGetPayload<object> => ({
  id: 'i', controlNo: 'FAR-X', source: 'TRANSFER', transferId: null, franchiseLocationId: 'f', fromLocationId: 'w', issueDate: d('2026-09-01'), originalDueDate: d('2026-10-01'), dueDate: d('2026-10-01'),
  originalAmount: new Prisma.Decimal(100000), amount: new Prisma.Decimal(100000), principalPaid: new Prisma.Decimal(0), penalty: new Prisma.Decimal(0), penaltyPaid: new Prisma.Decimal(0), interest: new Prisma.Decimal(0), interestPaid: new Prisma.Decimal(0),
  waivedTotal: new Prisma.Decimal(0), penaltyAppliedOn: null, interestThrough: null, status: 'OPEN', flaggedAt: null, remindedAt: null, notes: null, createdBy: null, createdAt: new Date(), updatedAt: new Date(), ...o,
});

describe('franchise receivables: the memo of July 31, 2026', () => {
  it('reproduces the memo examples on ₱100,000: 1 day ₱2,100 · 5 days ₱2,500 · 10 days ₱3,000 · 30 days ₱5,000', () => {
    const due = inv();
    for (const [days, charges] of [[1, 2100], [5, 2500], [10, 3000], [30, 5000]] as const) {
      const asOf = new Date(d('2026-10-01').getTime() + days * 86400000);
      const p = FranchiseArService.project(due, rules, asOf);
      expect(p.chargesDue.toNumber(), `${days} days`).toBe(charges);
      expect(p.totalDue.toNumber()).toBe(100000 + charges);
      expect(p.daysOverdue).toBe(days);
    }
  });
  it('charges nothing on or before the due date, and never before the memo takes effect', () => {
    expect(FranchiseArService.project(inv(), rules, d('2026-10-01')).chargesDue.toNumber()).toBe(0);
    const old = inv({ issueDate: d('2026-06-01'), originalDueDate: d('2026-07-01'), dueDate: d('2026-07-01') });
    // due 1 July, memo effective 1 August: day 1 of charges is 1 August, penalty once + interest from then
    const p = FranchiseArService.project(old, rules, d('2026-08-05'));
    expect(p.penalty.toNumber()).toBe(2000); expect(p.interest.toNumber()).toBe(500);
  });
  it('interest is on the unpaid goods only, one-time penalty never repeats, and saved charges are not counted twice', () => {
    const settled = inv({ penalty: new Prisma.Decimal(2000), penaltyAppliedOn: d('2026-10-02'), interest: new Prisma.Decimal(500), interestThrough: d('2026-10-06'), principalPaid: new Prisma.Decimal(50000) });
    const p = FranchiseArService.project(settled, rules, d('2026-10-11')); // 5 more days on ₱50,000 unpaid = ₱250
    expect(p.penalty.toNumber()).toBe(2000); expect(p.interest.toNumber()).toBe(750); expect(p.unpaid.toNumber()).toBe(50000);
  });
  it('an extension stops charges until the new due date', () => {
    const extended = inv({ dueDate: d('2026-10-31'), penalty: new Prisma.Decimal(2000), penaltyAppliedOn: d('2026-10-02'), interest: new Prisma.Decimal(500), interestThrough: d('2026-10-31') });
    expect(FranchiseArService.project(extended, rules, d('2026-10-20')).chargesDue.toNumber()).toBe(2500);
    const after = FranchiseArService.project(extended, rules, d('2026-11-02')); // 2 days after the new due date
    expect(after.interest.toNumber()).toBe(700); expect(after.penalty.toNumber()).toBe(2000);
  });
  it('keeps centavos: ₱12,345.67 unpaid for 3 days', () => {
    const p = FranchiseArService.project(inv({ amount: new Prisma.Decimal('12345.67') }), rules, d('2026-10-04'));
    expect(p.penalty.toFixed(2)).toBe('246.91'); expect(p.interest.toFixed(2)).toBe('37.04');
  });
  it('a paid invoice accrues nothing', () => {
    expect(FranchiseArService.project(inv({ status: 'PAID', principalPaid: new Prisma.Decimal(100000) }), rules, d('2026-12-01')).chargesDue.toNumber()).toBe(0);
  });
});
