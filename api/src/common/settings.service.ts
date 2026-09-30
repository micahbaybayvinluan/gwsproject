import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Admin-configurable thresholds (§6.1 auto-approve rules, §7.4 consignment setting, etc.). */
export const SETTING_DEFAULTS: Record<string, unknown> = {
  'approval.cost_unchanged_auto_hours': 24,
  'approval.transfer_internal_auto_max': null, // ₱ at cost; null = off
  'approval.transfer_franchise_auto_max': null,
  'approval.special_price_auto_discount_pct': 0,
  'consignment_in_on_balance_sheet': false,
  'alerts.near_expiry_days': 30,
  'alerts.expiry_first_notice_months': 6,
  'gl.auto_posting_enabled': false, // Phase 2 switch
  'gl.ni_allocation_basis': 'REVENUE',
  'attachments.required': { SalesDoc: ['ONLINE', 'CREDIT_CARD'], ReceivingDoc: true, ExpenseDoc: true },
  'session.idle_minutes_default': 30,
  'session.idle_minutes_long': 720,
  'fiscal.year_start': '2026-01-01',
  'discrepancy.window_days': 7,
  // customer re-order follow-ups (owner request 2026-09-27): messages the Owner can edit; {customer} {product} {store} {storePhone} are filled in
  // e-commerce: shipped orders neither paid nor returned after this many days are overdue; the warehouse the pull-outs come from
  'ecom.overdue_days': 30,
  // the margin the Owner wants to keep on e-commerce sales after platform fees, ads and cost of goods
  'ecom.target_margin_pct': 20,
  // company letterhead as on the company memo (the Owner uploads the logo in Settings)
  'company.letterhead': { name: 'Get Wheysted Supplements', address: '9050 NIA Rd. Sitio Niyugan Paliparan 1 Dasmarinas Cavite', contact: '+63 967 493 9363 / www.getwheystedsupplements.ph', tin: '', logoDataUrl: null },
  // credit-card price (owner request 2026-09-30, memo 2026-09-21): the card fee percent and how it is applied (GROSS_UP = SRP ÷ (1 − %), ADD = SRP × (1 + %))
  'pricing.cc_markup_pct': 4,
  // franchise receivables (memo 2026-07-31): days to pay after receiving, one-time penalty and daily interest on the unpaid balance once overdue, from when the memo takes effect; flagged after this many days overdue (two months)
  'franchise.ar.terms_days': 30,
  'franchise.ar.penalty_pct': 2,
  'franchise.ar.daily_interest_pct': 0.1,
  'franchise.ar.effective_from': '2026-08-01',
  'franchise.ar.flag_days': 60,
  'franchise.ar.remind_days_before': 3,
  // 6-Pack Card: stickers for one card, the discount booked as an expense
  'sixpack.stickers_per_card': 6,
  'sixpack.card_value': 300,
  'pricing.cc_method': 'GROSS_UP',
  'ecom.warehouse_code': 'WH',
  'followup.auto_sms': false,
  'followup.auto_email': false,
  'followup.sms_template': 'Hi {customer}! This is {store}. Your {product} may be running out soon. Call or text us at {storePhone} to reserve your next one. Thank you!',
  'followup.email_subject': 'Time to restock your {product}?',
  'followup.email_template': 'Hi {customer},\n\nThank you for buying {product} at {store}. By now you may be close to finishing it. Reply to this email or call us at {storePhone} and we will have your next one ready.\n\nGet Wheysted Supplements',
};

@Injectable()
export class SettingsService {
  private cache = new Map<string, { v: unknown; at: number }>();
  constructor(private prisma: PrismaService) {}

  async get<T = unknown>(key: string): Promise<T> {
    const c = this.cache.get(key);
    if (c && Date.now() - c.at < 10_000) return c.v as T;
    const row = await this.prisma.db.setting.findUnique({ where: { key } });
    const v = row ? (row.value as T) : (SETTING_DEFAULTS[key] as T);
    this.cache.set(key, { v, at: Date.now() });
    return v;
  }
  async set(key: string, value: unknown, userId?: string) {
    this.cache.delete(key);
    return this.prisma.db.setting.upsert({ where: { key }, create: { key, value: value as object, updatedBy: userId }, update: { value: value as object, updatedBy: userId } });
  }
  async all() {
    const rows = await this.prisma.db.setting.findMany();
    const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
    // the letterhead (with its logo image) has its own screen
    for (const r of rows) if (r.key !== 'company.letterhead') out[r.key] = r.value;
    return out;
  }
}
