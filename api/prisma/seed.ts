/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { ROLE_CATALOGUE } from '../src/common/permissions';
import { HDMF_2024, PHIC_2025, sssRows2025 } from '../src/payroll/contribution-tables';
import { ACCOUNT_TEMPLATES } from '../src/gl/account-templates';
import { seedWorkbooks } from './seed-workbooks';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { normName, parseEcomMasterlist } from '../src/pricing/ecom-masterlist';
import { ensurePlasticFranchisePrices } from '../src/pricing/plastic-prices';

const prisma = new PrismaClient();
const DEV_PASSWORD = process.env.SEED_PASSWORD || 'ChangeMe!2026';

const LOCATIONS: { code: string; shortCode: string; name: string; type: 'WAREHOUSE' | 'BRANCH' | 'FRANCHISE' | 'OFFICE' | 'CONSIGNEE' | 'VIRTUAL'; isSelling?: boolean }[] = [
  { code: 'WH', shortCode: 'WH', name: 'Warehouse', type: 'WAREHOUSE', isSelling: true },
  { code: 'WESTAVE', shortCode: 'WA', name: 'West Ave', type: 'BRANCH', isSelling: true },
  { code: 'CSR', shortCode: 'CS', name: 'CSR', type: 'BRANCH', isSelling: true },
  { code: 'IMUS', shortCode: 'IM', name: 'Imus Cavite', type: 'BRANCH', isSelling: true },
  { code: 'LAGUNA', shortCode: 'LG', name: 'Laguna', type: 'BRANCH', isSelling: true },
  { code: 'DASMA', shortCode: 'DS', name: 'Dasmariñas', type: 'BRANCH', isSelling: true },
  { code: 'VITOCRUZ', shortCode: 'VC', name: 'Vito Cruz', type: 'BRANCH', isSelling: true },
  { code: 'OFFICE', shortCode: 'OF', name: 'Office', type: 'OFFICE' },
  { code: '711', shortCode: 'SE', name: '7-11 / Lawson', type: 'CONSIGNEE' },
  { code: 'MAYON', shortCode: 'MY', name: 'Mayon', type: 'FRANCHISE', isSelling: true },
  { code: 'MALOLOS', shortCode: 'ML', name: 'Malolos Bulacan', type: 'FRANCHISE', isSelling: true },
  { code: 'PARANAQUE', shortCode: 'PQ', name: 'Parañaque', type: 'FRANCHISE', isSelling: true },
  { code: 'ISABELA', shortCode: 'IS', name: 'Isabela', type: 'FRANCHISE', isSelling: true },
  { code: 'BAGUIO', shortCode: 'BG', name: 'Baguio', type: 'FRANCHISE', isSelling: true },
  { code: 'PANGASINAN', shortCode: 'PG', name: 'Pangasinan', type: 'FRANCHISE', isSelling: true },
  { code: 'NAGA', shortCode: 'NG', name: 'Naga', type: 'FRANCHISE', isSelling: true },
  { code: 'BACOLOD', shortCode: 'BC', name: 'Bacolod', type: 'FRANCHISE', isSelling: true },
  { code: 'CALOOCAN', shortCode: 'CL', name: 'Caloocan', type: 'FRANCHISE', isSelling: true },
  { code: 'RIZAL', shortCode: 'RZ', name: 'Rizal', type: 'FRANCHISE', isSelling: true },
  { code: 'V-TRANSIT', shortCode: 'IT', name: 'In Transit', type: 'VIRTUAL' },
  { code: 'V-OPENING', shortCode: 'OP', name: 'Opening Stock', type: 'VIRTUAL' },
  { code: 'V-CUSTRET', shortCode: 'CR', name: 'Customer Returns', type: 'VIRTUAL' },
  { code: 'V-PULLOUT1', shortCode: 'P1', name: 'Pull Out 1', type: 'VIRTUAL' },
  { code: 'V-PULLOUT2', shortCode: 'P2', name: 'Pull Out 2', type: 'VIRTUAL' },
  { code: 'V-PULLOUT3', shortCode: 'P3', name: 'Pull Out 3', type: 'VIRTUAL' },
  { code: 'V-REPLACE', shortCode: 'RP', name: 'For Replacement', type: 'VIRTUAL' },
  // e-commerce holding places: items pulled out of the Warehouse for platform orders, until the platform pays or the parcel returns
  { code: 'ECOM-TIKTOK', shortCode: 'TT', name: 'TikTok – with courier', type: 'VIRTUAL' },
  { code: 'ECOM-SHOPEE', shortCode: 'SP', name: 'Shopee – with courier', type: 'VIRTUAL' },
  { code: 'ECOM-LAZADA', shortCode: 'LZ', name: 'Lazada – with courier', type: 'VIRTUAL' },
];

const CATEGORIES: { name: string; accountingClass: 'SUPPLEMENT' | 'FREEBIE' | 'PLASTIC' | 'APPAREL' | 'EQUIPMENT' | 'OTHER' | 'REPACKED' | 'BUNDLE' }[] = [
  { name: 'Supplements', accountingClass: 'SUPPLEMENT' }, { name: 'Freebies', accountingClass: 'FREEBIE' }, { name: 'Plastic / Ecobag', accountingClass: 'PLASTIC' },
  { name: 'Apparel', accountingClass: 'APPAREL' }, { name: 'Equipment', accountingClass: 'EQUIPMENT' }, { name: 'Repacked', accountingClass: 'REPACKED' },
  { name: 'Promo Bundles', accountingClass: 'BUNDLE' }, { name: 'Others', accountingClass: 'OTHER' },
];

const TIERS = [['RETAIL', 'Retail (SRP)'], ['DEALER', 'Dealer'], ['FRANCHISE', 'Franchise'], ['AGENT', 'Agent'], ['WHOLESALE', 'Wholesale'], ['CC', 'Credit card'], ['TIKTOK', 'TikTok'], ['SHOPEE', 'Shopee'], ['LAZADA', 'Lazada']];

/** One test account per role (README lists them). */
const TEST_USERS: { username: string; role: string; fullName: string; locations?: string[] }[] = [
  { username: 'admin', role: 'ADMIN', fullName: 'Owner (Admin)' },
  { username: 'ext.auditor', role: 'EXTERNAL_AUDITOR', fullName: 'External Auditor' },
  { username: 'head.auditor', role: 'HEAD_AUDITOR', fullName: 'Head Auditor' },
  { username: 'asst.auditor', role: 'ASST_AUDITOR', fullName: 'Assistant Auditor' },
  { username: 'audit.assoc', role: 'AUDIT_ASSOCIATE', fullName: 'Audit Associate' },
  { username: 'wh.incharge', role: 'WAREHOUSE_IN_CHARGE', fullName: 'Warehouse In-Charge', locations: ['WH'] },
  { username: 'wh.assoc', role: 'WAREHOUSE_ASSOCIATE', fullName: 'Warehouse Associate', locations: ['WH'] },
  { username: 'sales.westave', role: 'SALES_ASSOCIATE', fullName: 'Sales Associate – West Ave', locations: ['WESTAVE'] },
  { username: 'sales.csr', role: 'SALES_ASSOCIATE', fullName: 'Sales Associate – CSR', locations: ['CSR'] },
  { username: 'sales.imus', role: 'SALES_ASSOCIATE', fullName: 'Sales Associate – Imus Cavite', locations: ['IMUS'] },
  { username: 'sales.laguna', role: 'SALES_ASSOCIATE', fullName: 'Sales Associate – Laguna', locations: ['LAGUNA'] },
  { username: 'sales.dasma', role: 'SALES_ASSOCIATE', fullName: 'Sales Associate – Dasmariñas', locations: ['DASMA'] },
  { username: 'sales.vitocruz', role: 'SALES_ASSOCIATE', fullName: 'Sales Associate – Vito Cruz', locations: ['VITOCRUZ'] },
  { username: 'sales.wh', role: 'SALES_ASSOCIATE', fullName: 'Sales Associate – Warehouse store', locations: ['WH'] },
  { username: 'fr.mayon.assoc', role: 'FRANCHISE_SALES_ASSOCIATE', fullName: 'Franchise Associate – Mayon', locations: ['MAYON'] },
  { username: 'fr.mayon.owner', role: 'FRANCHISE_OWNER', fullName: 'Franchise Owner – Mayon', locations: ['MAYON'] },
  { username: 'fr.malolos.assoc', role: 'FRANCHISE_SALES_ASSOCIATE', fullName: 'Franchise Associate – Malolos', locations: ['MALOLOS'] },
  { username: 'fr.malolos.owner', role: 'FRANCHISE_OWNER', fullName: 'Franchise Owner – Malolos', locations: ['MALOLOS'] },
  { username: 'custom.user', role: 'CUSTOM', fullName: 'Custom Role User' },
  { username: 'acct.head', role: 'ACCOUNTING_HEAD', fullName: 'Accounting Head' },
  { username: 'acct.assoc', role: 'ACCOUNTING_ASSOCIATE', fullName: 'Accounting Associate' },
  { username: 'hr.staff', role: 'HR_STAFF', fullName: 'HR Staff' },
  { username: 'field.auditor', role: 'FIELD_AUDITOR', fullName: 'Field Auditor', locations: [] }, // inventory of every location
  { username: 'exec.assistant', role: 'EXECUTIVE_ASSISTANT', fullName: 'Executive Assistant' },
  { username: 'ecomm.assoc', role: 'ECOMM_ASSOCIATE', fullName: 'E-comm Associate' },
  { username: 'sales.manager', role: 'SALES_MANAGER', fullName: 'Sales Manager' },
  { username: 'agent.jerick', role: 'AGENT', fullName: 'Jerick Quinto (Agent)' },
  { username: 'franchise.coord', role: 'FRANCHISE_COORDINATOR', fullName: 'Franchise Coordinator' },
  { username: 'asst.franchise.coord', role: 'ASST_FRANCHISE_COORDINATOR', fullName: 'Asst. Franchise Coordinator' },
];

async function main() {
  console.log('Seeding roles…');
  for (const r of ROLE_CATALOGUE) {
    await prisma.role.upsert({ where: { key: r.key }, create: { key: r.key, name: r.name, description: r.description, permissions: r.permissions }, update: { name: r.name, description: r.description, permissions: r.permissions } });
  }
  console.log('Seeding locations…');
  for (const l of LOCATIONS) {
    // a location added later in the app may already use this 2-letter code: the new location then gets its own code on first use
    const taken = await prisma.location.findFirst({ where: { shortCode: l.shortCode, code: { not: l.code } } });
    await prisma.location.upsert({ where: { code: l.code }, create: { ...l, shortCode: taken ? null : l.shortCode, isSelling: !!l.isSelling }, update: { name: l.name, type: l.type, isSelling: !!l.isSelling } });
  }
  console.log('Seeding categories & tiers…');
  for (const c of CATEGORIES) await prisma.category.upsert({ where: { name: c.name }, create: c, update: { accountingClass: c.accountingClass } });
  for (const [i, [key, name]] of TIERS.entries()) await prisma.priceTier.upsert({ where: { key }, create: { key, name, sortOrder: i, isSystem: true }, update: { name } });
  console.log('Seeding account templates…');
  for (const [i, t] of ACCOUNT_TEMPLATES.entries()) await prisma.accountTemplate.upsert({ where: { key: t.key }, create: { ...t, sortOrder: i }, update: { ...t, sortOrder: i } });

  console.log('Seeding test users…');
  const hash = await argon2.hash(DEV_PASSWORD);
  for (const [i, u] of TEST_USERS.entries()) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: u.role } });
    const user = await prisma.user.upsert({
      where: { username: u.username },
      create: { username: u.username, email: `${u.username}@gws.local`, fullName: u.fullName, roleId: role.id, passwordHash: hash, mustChangePassword: false },
      update: { roleId: role.id, fullName: u.fullName },
    });
    // demo company ID so each simulation account is tagged to one (fictional) person; never overwrites an ID set by the Admin
    if (!user.idNumber) await prisma.user.update({ where: { id: user.id }, data: { idNumber: `DEMO-${String(i + 1).padStart(3, '0')}` } });
    if (u.locations) {
      await prisma.userLocationAssignment.deleteMany({ where: { userId: user.id } });
      for (const code of u.locations) {
        const loc = await prisma.location.findUniqueOrThrow({ where: { code } });
        await prisma.userLocationAssignment.create({ data: { userId: user.id, locationId: loc.id } });
        if (u.role === 'FRANCHISE_OWNER') await prisma.location.update({ where: { id: loc.id }, data: { franchiseOwnerUserId: user.id } });
      }
    }
  }
  // Demo employee records linked to the company staff accounts (so charges, payslips and "My Pay & Charges" reach the right person)
  const STAFF_RATES: Record<string, number> = { SALES_ASSOCIATE: 16000, WAREHOUSE_ASSOCIATE: 16000, WAREHOUSE_IN_CHARGE: 20000, FIELD_AUDITOR: 20000, AUDIT_ASSOCIATE: 18000, ASST_AUDITOR: 25000, HEAD_AUDITOR: 35000, ACCOUNTING_ASSOCIATE: 20000, ACCOUNTING_HEAD: 35000, HR_STAFF: 22000 };
  for (const u of TEST_USERS.filter((x) => STAFF_RATES[x.role])) {
    const user = await prisma.user.findUniqueOrThrow({ where: { username: u.username }, include: { employee: true, assignments: true } });
    if (user.employee) continue;
    await prisma.employee.create({ data: { employeeNo: user.idNumber ?? u.username, fullName: u.fullName, position: u.role.replace(/_/g, ' ').toLowerCase(), basicRate: STAFF_RATES[u.role].toFixed(2), locationId: user.assignments[0]?.locationId ?? null, userId: user.id, sssNo: `34-${String(1000000 + TEST_USERS.indexOf(u)).slice(-7)}-0`, phicNo: `12-${String(500000000 + TEST_USERS.indexOf(u)).slice(-9)}-1`, hdmfNo: `1211-${String(10000000 + TEST_USERS.indexOf(u)).slice(-8)}` } });
  }
  // Default SSS / PhilHealth / Pag-IBIG tables (editable by HR)
  if (!(await prisma.contributionTable.count())) {
    const eff = new Date('2025-01-01T00:00:00Z');
    await prisma.contributionTable.createMany({ data: [{ kind: 'SSS', effectiveFrom: eff, rows: sssRows2025() as never }, { kind: 'PHIC', effectiveFrom: eff, rows: PHIC_2025 }, { kind: 'HDMF', effectiveFrom: eff, rows: HDMF_2024 }] });
  }
  // Demo cash funds (₱5,000) at the company branches and the warehouse store — Admin / Accounting Head can change or add funds
  for (const code of ['WESTAVE', 'CSR', 'IMUS', 'LAGUNA', 'DASMA', 'VITOCRUZ', 'WH']) {
    const loc = await prisma.location.findUniqueOrThrow({ where: { code } });
    if (await prisma.cashFund.findUnique({ where: { locationId: loc.id } })) continue;
    const f = await prisma.cashFund.create({ data: { locationId: loc.id, imprestAmount: '5000.00', balance: '5000.00' } });
    await prisma.cashFundTxn.create({ data: { fundId: f.id, locationId: loc.id, businessDate: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z'), kind: 'SETUP', amount: '5000.00', balanceAfter: '5000.00', notes: 'Demo fund (seed)' } });
  }

  // Franchise customers mirror franchise locations (AR – Franchise <name>)
  for (const l of LOCATIONS.filter((x) => x.type === 'FRANCHISE')) {
    const loc = await prisma.location.findUniqueOrThrow({ where: { code: l.code } });
    await prisma.customer.upsert({ where: { code: `FR-${l.code}` }, create: { code: `FR-${l.code}`, name: `Franchise ${l.name}`, type: 'FRANCHISE', locationId: loc.id }, update: { name: `Franchise ${l.name}` } });
  }
  // riders and agents for the simulation
  const riderNames: Record<string, string[]> = { WESTAVE: ['Jaime', 'Carlo'], CSR: ['Marlon'], IMUS: ['Rey'], LAGUNA: ['Dan'], DASMA: ['Jaime', 'Paolo'], VITOCRUZ: ['Ben'], WH: ['Truck 1'] };
  for (const [code, names] of Object.entries(riderNames)) {
    const loc = await prisma.location.findUniqueOrThrow({ where: { code } });
    for (const name of names) if (!(await prisma.rider.findFirst({ where: { locationId: loc.id, name } }))) await prisma.rider.create({ data: { name, locationId: loc.id } });
  }
  for (const [code, name, onPayroll] of [['WESTAVE', 'Jerick Quinto', true], ['DASMA', 'Matt Angelo Asma', false], ['WH', 'Raymart Bagatua', true]] as const) {
    const loc = await prisma.location.findUniqueOrThrow({ where: { code } });
    if (!(await prisma.agent.findFirst({ where: { name } }))) await prisma.agent.create({ data: { name, locationId: loc.id, onPayroll } });
  }
  // the demo Agent account sees Jerick Quinto's sales at every branch
  const jerickUser = await prisma.user.findUnique({ where: { username: 'agent.jerick' } });
  if (jerickUser) await prisma.agent.updateMany({ where: { name: 'Jerick Quinto', userId: null }, data: { userId: jerickUser.id } });
  for (const [i, d] of ['Topform', 'Level Up', 'Good Stuff', 'Juan Whey', 'Whey Avenue'].entries()) {
    await prisma.customer.upsert({ where: { code: `DLR-${String(i + 1).padStart(3, '0')}` }, create: { code: `DLR-${String(i + 1).padStart(3, '0')}`, name: d, type: 'DEALER' }, update: { name: d } });
  }
  await seedWorkbooks(prisma, process.env.SEED_DIR || path.resolve(__dirname, '../../seed'));
  // e-commerce price lists from the masterlist (TikTok and Shopee prices exactly as written; Lazada follows Shopee; the Admin edits them in the app)
  const ecomFile = path.resolve(process.env.SEED_DIR || path.resolve(__dirname, '../../seed'), 'TIKTOK_SHOPEE_MASTERLIST_2026.xlsx');
  if (fs.existsSync(ecomFile)) {
    const rows = await parseEcomMasterlist(fs.readFileSync(ecomFile));
    const byName = new Map<string, string>(); for (const p of await prisma.product.findMany({ select: { id: true, name: true } })) if (!byName.has(normName(p.name))) byName.set(normName(p.name), p.id);
    const day = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z'); let n = 0;
    for (const r of rows) { const id = byName.get(normName(r.name)); if (!id) continue; for (const [tier, price] of [['TIKTOK', r.tiktok], ['SHOPEE', r.shopee]] as const) if (price != null) { await prisma.priceList.upsert({ where: { productId_tier_effectiveFrom: { productId: id, tier, effectiveFrom: day } }, create: { productId: id, tier, effectiveFrom: day, price: price.toFixed(2) }, update: { price: price.toFixed(2) } }); n++; } }
    console.log(`E-commerce masterlist: ${n} platform prices set (${rows.length} rows, ${rows.filter((r) => !byName.has(normName(r.name))).length} names not found in the product list).`);
  }
  console.log(`Plastic bags: franchise price set on ${await ensurePlasticFranchisePrices(prisma)} product(s) (L 4, M 3, S 3, XL 5).`);
  console.log(`Seed complete. All test users use password: ${DEV_PASSWORD}`);
}

main().catch((e) => {
  console.error(e);
  // the top of a long error scrolls out of view in Terminal; repeat the useful part last
  const msg = String((e as Error)?.message ?? e);
  console.error('\nSeed failed: ' + msg.split('\n').filter((l) => l.trim()).slice(-6).join('\n'));
  if (/DATABASE_URL|P1012|Validation Error Count/.test(msg)) console.error('Fix: the settings file api/.env is missing or has no DATABASE_URL. Run "node scripts/ensure-env.mjs" in the gws-erp folder, then run this again.');
  else if (/denied access|P1000|Authentication failed/.test(msg)) console.error('Fix: the database refused the user name or password in api/.env (DATABASE_URL). With Docker it should be postgresql://gws:gws@localhost:5432/gws?schema=public');
  else if (/P1001|Can't reach database/.test(msg)) console.error('Fix: the database is not running. Open Docker Desktop, run "docker compose up -d postgres redis", then run this again.');
  process.exit(1);
}).finally(() => prisma.$disconnect());
