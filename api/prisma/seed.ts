/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { ROLE_CATALOGUE } from '../src/common/permissions';
import { ACCOUNT_TEMPLATES } from '../src/gl/account-templates';
import { seedWorkbooks } from './seed-workbooks';
import * as path from 'node:path';

const prisma = new PrismaClient();
const DEV_PASSWORD = process.env.SEED_PASSWORD || 'ChangeMe!2026';

const LOCATIONS: { code: string; name: string; type: 'WAREHOUSE' | 'BRANCH' | 'FRANCHISE' | 'OFFICE' | 'CONSIGNEE' | 'VIRTUAL'; isSelling?: boolean }[] = [
  { code: 'WH', name: 'Warehouse', type: 'WAREHOUSE', isSelling: true },
  { code: 'WESTAVE', name: 'West Ave', type: 'BRANCH', isSelling: true },
  { code: 'CSR', name: 'CSR', type: 'BRANCH', isSelling: true },
  { code: 'IMUS', name: 'Imus Cavite', type: 'BRANCH', isSelling: true },
  { code: 'LAGUNA', name: 'Laguna', type: 'BRANCH', isSelling: true },
  { code: 'DASMA', name: 'Dasmariñas', type: 'BRANCH', isSelling: true },
  { code: 'VITOCRUZ', name: 'Vito Cruz', type: 'BRANCH', isSelling: true },
  { code: 'OFFICE', name: 'Office', type: 'OFFICE' },
  { code: '711', name: '7-11 / Lawson', type: 'CONSIGNEE' },
  { code: 'MAYON', name: 'Mayon', type: 'FRANCHISE', isSelling: true },
  { code: 'MALOLOS', name: 'Malolos Bulacan', type: 'FRANCHISE', isSelling: true },
  { code: 'PARANAQUE', name: 'Parañaque', type: 'FRANCHISE', isSelling: true },
  { code: 'ISABELA', name: 'Isabela', type: 'FRANCHISE', isSelling: true },
  { code: 'BAGUIO', name: 'Baguio', type: 'FRANCHISE', isSelling: true },
  { code: 'PANGASINAN', name: 'Pangasinan', type: 'FRANCHISE', isSelling: true },
  { code: 'NAGA', name: 'Naga', type: 'FRANCHISE', isSelling: true },
  { code: 'BACOLOD', name: 'Bacolod', type: 'FRANCHISE', isSelling: true },
  { code: 'CALOOCAN', name: 'Caloocan', type: 'FRANCHISE', isSelling: true },
  { code: 'RIZAL', name: 'Rizal', type: 'FRANCHISE', isSelling: true },
  { code: 'V-TRANSIT', name: 'In Transit', type: 'VIRTUAL' },
  { code: 'V-OPENING', name: 'Opening Stock', type: 'VIRTUAL' },
  { code: 'V-CUSTRET', name: 'Customer Returns', type: 'VIRTUAL' },
  { code: 'V-PULLOUT1', name: 'Pull Out 1', type: 'VIRTUAL' },
  { code: 'V-PULLOUT2', name: 'Pull Out 2', type: 'VIRTUAL' },
  { code: 'V-PULLOUT3', name: 'Pull Out 3', type: 'VIRTUAL' },
  { code: 'V-REPLACE', name: 'For Replacement', type: 'VIRTUAL' },
];

const CATEGORIES: { name: string; accountingClass: 'SUPPLEMENT' | 'FREEBIE' | 'PLASTIC' | 'APPAREL' | 'EQUIPMENT' | 'OTHER' | 'REPACKED' | 'BUNDLE' }[] = [
  { name: 'Supplements', accountingClass: 'SUPPLEMENT' }, { name: 'Freebies', accountingClass: 'FREEBIE' }, { name: 'Plastic / Ecobag', accountingClass: 'PLASTIC' },
  { name: 'Apparel', accountingClass: 'APPAREL' }, { name: 'Equipment', accountingClass: 'EQUIPMENT' }, { name: 'Repacked', accountingClass: 'REPACKED' },
  { name: 'Promo Bundles', accountingClass: 'BUNDLE' }, { name: 'Others', accountingClass: 'OTHER' },
];

const TIERS = [['RETAIL', 'Retail (SRP)'], ['DEALER', 'Dealer'], ['FRANCHISE', 'Franchise'], ['AGENT', 'Agent'], ['WHOLESALE', 'Wholesale']];

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
  { username: 'field.auditor', role: 'FIELD_AUDITOR', fullName: 'Field Auditor', locations: ['WESTAVE', 'CSR'] },
];

async function main() {
  console.log('Seeding roles…');
  for (const r of ROLE_CATALOGUE) {
    await prisma.role.upsert({ where: { key: r.key }, create: { key: r.key, name: r.name, description: r.description, permissions: r.permissions }, update: { name: r.name, description: r.description, permissions: r.permissions } });
  }
  console.log('Seeding locations…');
  for (const l of LOCATIONS) await prisma.location.upsert({ where: { code: l.code }, create: { ...l, isSelling: !!l.isSelling }, update: { name: l.name, type: l.type, isSelling: !!l.isSelling } });
  console.log('Seeding categories & tiers…');
  for (const c of CATEGORIES) await prisma.category.upsert({ where: { name: c.name }, create: c, update: { accountingClass: c.accountingClass } });
  for (const [i, [key, name]] of TIERS.entries()) await prisma.priceTier.upsert({ where: { key }, create: { key, name, sortOrder: i, isSystem: true }, update: { name } });
  console.log('Seeding account templates…');
  for (const [i, t] of ACCOUNT_TEMPLATES.entries()) await prisma.accountTemplate.upsert({ where: { key: t.key }, create: { ...t, sortOrder: i }, update: { ...t, sortOrder: i } });

  console.log('Seeding test users…');
  const hash = await argon2.hash(DEV_PASSWORD);
  for (const u of TEST_USERS) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: u.role } });
    const user = await prisma.user.upsert({
      where: { username: u.username },
      create: { username: u.username, email: `${u.username}@gws.local`, fullName: u.fullName, roleId: role.id, passwordHash: hash, mustChangePassword: false },
      update: { roleId: role.id, fullName: u.fullName },
    });
    if (u.locations) {
      await prisma.userLocationAssignment.deleteMany({ where: { userId: user.id } });
      for (const code of u.locations) {
        const loc = await prisma.location.findUniqueOrThrow({ where: { code } });
        await prisma.userLocationAssignment.create({ data: { userId: user.id, locationId: loc.id } });
        if (u.role === 'FRANCHISE_OWNER') await prisma.location.update({ where: { id: loc.id }, data: { franchiseOwnerUserId: user.id } });
      }
    }
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
  for (const [i, d] of ['Topform', 'Level Up', 'Good Stuff', 'Juan Whey', 'Whey Avenue'].entries()) {
    await prisma.customer.upsert({ where: { code: `DLR-${String(i + 1).padStart(3, '0')}` }, create: { code: `DLR-${String(i + 1).padStart(3, '0')}`, name: d, type: 'DEALER' }, update: { name: d } });
  }
  await seedWorkbooks(prisma, process.env.SEED_DIR || path.resolve(__dirname, '../../seed'));
  console.log(`Seed complete. All test users use password: ${DEV_PASSWORD}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
