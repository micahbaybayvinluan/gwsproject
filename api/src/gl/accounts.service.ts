import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountClass, Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { ACCOUNT_TEMPLATES, GLOBAL_ACCOUNTS, NORMAL_BALANCE } from './account-templates';
import { AccountResolver, MissingAccountError } from './posting-rules';


/** Chart of accounts, branch templating (§10.2) and the AccountResolver used by posting rules. */
@Injectable()
export class AccountsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  list(q: { class?: string; branchTagId?: string; entryScope?: string; paymentOnly?: boolean; active?: boolean } = {}) {
    return this.prisma.db.account.findMany({
      where: { class: q.class as AccountClass | undefined, branchTagId: q.branchTagId, entryScope: q.entryScope as never, isPaymentAccount: q.paymentOnly ? true : undefined, active: q.active ?? true },
      include: { branchTag: { select: { id: true, code: true, name: true } }, template: { select: { key: true } } }, orderBy: [{ code: 'asc' }],
    });
  }
  async get(id: string) { const a = await this.prisma.db.account.findUnique({ where: { id }, include: { branchTag: true, template: true } }); if (!a) throw new NotFoundException(); return a; }

  /** Expense accounts a branch user may pick (§8.6): BRANCH/BOTH scope tagged to the location. */
  branchExpenseAccounts(locationId: string) {
    return this.prisma.db.account.findMany({ where: { active: true, class: { in: ['OPEX', 'DIRECT_COST'] }, branchTagId: locationId, entryScope: { in: ['BRANCH', 'BOTH'] } }, orderBy: { title: 'asc' } });
  }
  mainExpenseAccounts() { return this.prisma.db.account.findMany({ where: { active: true, class: { in: ['OPEX', 'DIRECT_COST'] }, entryScope: { in: ['MAIN', 'BOTH'] } }, orderBy: { title: 'asc' } }); }
  /** Payment accounts (cash/bank/GCash/platform) selectable on a sale at a location. */
  paymentAccounts(locationId?: string) {
    return this.prisma.db.account.findMany({ where: { active: true, isPaymentAccount: true, OR: [{ branchTagId: null }, { branchTagId: locationId ?? undefined }] }, orderBy: { title: 'asc' } });
  }

  async create(data: { code?: string; title: string; class: AccountClass; branchTagId?: string | null; channelTag?: string | null; entryScope?: 'BRANCH' | 'MAIN' | 'BOTH'; isPaymentAccount?: boolean; paymentAccountType?: string | null; counterpartyType?: string | null; counterpartyId?: string | null; templateId?: string | null }, actorId: string, tx: Tx | null = null) {
    const db = (tx ?? this.prisma.db) as Tx;
    const code = data.code ?? (await this.nextCode(db, data.class));
    const a = await db.account.create({ data: { ...data, code, normalBalance: NORMAL_BALANCE[data.class], isPaymentAccount: data.isPaymentAccount ?? data.class === 'CASH', paymentAccountType: (data.paymentAccountType ?? null) as never, entryScope: data.entryScope ?? (data.branchTagId ? 'BRANCH' : 'MAIN'), createdBy: actorId } });
    await this.audit.log({ action: 'CREATE', entityType: 'Account', entityId: a.id, after: a, userId: actorId });
    return a;
  }
  async update(id: string, data: Prisma.AccountUncheckedUpdateInput, actorId: string) {
    const before = await this.get(id);
    const after = await this.prisma.db.account.update({ where: { id }, data: { ...data, updatedBy: actorId } });
    await this.audit.log({ action: 'UPDATE', entityType: 'Account', entityId: id, before, after });
    return after;
  }

  /** Code ranges in the workbook's numeric style: 1xxx assets, 2xxx liabilities, 3xxx equity, 6xxx revenue, 7xxx direct cost, 8xxx opex, 9xxx other income. */
  async nextCode(db: Tx, cls: AccountClass): Promise<string> {
    const base: Record<AccountClass, number> = { CASH: 1000, AR: 1200, INVENTORY: 1300, ADVANCES_TO: 1500, FIXED_ASSET: 1600, ACCUM_DEPN: 1700, CURRENT_LIABILITY: 2000, ADVANCES_FROM: 2500, EQUITY: 3000, REVENUE: 6000, DIRECT_COST: 7000, OPEX: 8000, OTHER_INCOME: 9000 };
    const last = await db.account.findFirst({ where: { class: cls, code: { gte: String(base[cls]), lt: String(base[cls] + 1000) } }, orderBy: { code: 'desc' } });
    let n = last ? parseInt(last.code, 10) + 1 : base[cls] + 1;
    while (await db.account.findUnique({ where: { code: String(n) } })) n++;
    return String(n);
  }

  /** §10.2 Generate the full templated set for a new branch (or the franchise subset). Idempotent: existing template+branch pairs are skipped. */
  async generateForLocation(locationId: string, actorId: string) {
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId } });
    const kind = loc.type === 'FRANCHISE' ? 'FRANCHISE' : 'BRANCH';
    const templates = await this.prisma.db.accountTemplate.findMany({ where: { appliesTo: { in: [kind, 'BOTH'] } }, orderBy: { sortOrder: 'asc' } });
    const created: string[] = [];
    await this.prisma.db.$transaction(async (tx) => {
      for (const t of templates) {
        const exists = await tx.account.findFirst({ where: { templateId: t.id, branchTagId: locationId } });
        if (exists) continue;
        const a = await this.create({ title: t.titlePattern.replace('{branch}', loc.name), class: t.class, branchTagId: locationId, channelTag: t.channelTag, entryScope: t.entryScope, templateId: t.id, paymentAccountType: t.key === 'PETTY_CASH' ? 'PETTY_CASH' : t.key === 'CASH_ON_HAND' ? 'CASH_DRAWER' : null, counterpartyType: t.key.startsWith('AR_FRANCHISE') ? 'FRANCHISE' : null, counterpartyId: t.key.startsWith('AR_FRANCHISE') ? locationId : null }, actorId, tx);
        created.push(a.title);
      }
      // Ensure global accounts exist
      for (const g of GLOBAL_ACCOUNTS) {
        const exists = await tx.account.findFirst({ where: { OR: [{ code: g.code }, { title: g.title }] } });
        if (!exists) { await this.create({ code: g.code, title: g.title, class: g.class, entryScope: 'MAIN', paymentAccountType: g.paymentAccountType ?? null }, actorId, tx); created.push(g.title); }
      }
    });
    return { created };
  }

  templates() { return this.prisma.db.accountTemplate.findMany({ orderBy: { sortOrder: 'asc' } }); }
  static readonly TEMPLATE_DEFS = ACCOUNT_TEMPLATES;

  /** Build a resolver with the current chart loaded once. */
  async resolver(tx: Tx | null = null): Promise<AccountResolver> {
    const db = (tx ?? this.prisma.db) as Tx;
    const accounts = await db.account.findMany({ where: { active: true }, include: { template: { select: { key: true } } } });
    const byTemplateBranch = new Map<string, string>();
    const byTitle = new Map<string, string>();
    const byCode = new Map<string, string>();
    const arByCounterparty = new Map<string, string>();
    const apBySupplier = new Map<string, string>();
    for (const a of accounts) {
      if (a.template && a.branchTagId) byTemplateBranch.set(`${a.template.key}|${a.branchTagId}`, a.id);
      byTitle.set(a.title, a.id); byCode.set(a.code, a.id);
      if (a.class === 'AR' && a.counterpartyId) arByCounterparty.set(a.counterpartyId, a.id);
      if (a.class === 'CURRENT_LIABILITY' && a.counterpartyType === 'SUPPLIER' && a.counterpartyId) apBySupplier.set(a.counterpartyId, a.id);
    }
    const globalByKey = new Map(GLOBAL_ACCOUNTS.map((g) => [g.key, byCode.get(g.code) ?? byTitle.get(g.title)]));
    const global = (key: string) => { const id = globalByKey.get(key); if (!id) throw new MissingAccountError(`global account ${key}`); return id; };
    const branch = (templateKey: string, locationId: string) => { const id = byTemplateBranch.get(`${templateKey}|${locationId}`); if (!id) throw new MissingAccountError(`${templateKey} for location ${locationId}`); return id; };
    return {
      global, branch,
      ar: (cp, branchLocationId) => {
        if (cp?.id && arByCounterparty.has(cp.id)) return arByCounterparty.get(cp.id)!;
        if (cp?.locationId && arByCounterparty.has(cp.locationId)) return arByCounterparty.get(cp.locationId)!;
        if (cp?.type === 'AGENT') return branch('AR_AGENT', branchLocationId);
        return branch('AR_OTHERS', branchLocationId);
      },
      ap: (supplierId, consignment) => (supplierId && apBySupplier.get(supplierId)) || global(consignment ? 'AP_CONSIGNMENT' : 'AP_SUPPLIERS'),
    };
  }

  async ensureGlobalAccounts(actorId: string) {
    let n = 0;
    for (const g of GLOBAL_ACCOUNTS) {
      const exists = await this.prisma.db.account.findFirst({ where: { OR: [{ code: g.code }, { title: g.title }] } });
      if (!exists) { await this.create({ code: g.code, title: g.title, class: g.class, entryScope: 'MAIN', paymentAccountType: g.paymentAccountType ?? null }, actorId); n++; }
    }
    return { created: n };
  }

  validateClass(cls: string) { if (!Object.keys(NORMAL_BALANCE).includes(cls)) throw new BadRequestException('Unknown account class'); }
}
