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
