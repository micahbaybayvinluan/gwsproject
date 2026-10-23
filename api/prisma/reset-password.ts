/* eslint-disable no-console */
// Reset one login from the terminal when nobody can get in:
//   pnpm reset-password <username> [new password] [--totp]      (--totp also clears the authenticator app so it can be set up again)
//   pnpm reset-password --all-demo [new password]               (every demo account made by the seed, default password ChangeMe!2026)
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const DEMO = ['admin', 'ext.auditor', 'head.auditor', 'asst.auditor', 'audit.assoc', 'wh.incharge', 'wh.assoc', 'sales.westave', 'sales.csr', 'sales.imus', 'sales.laguna', 'sales.dasma', 'sales.vitocruz', 'sales.wh', 'fr.mayon.assoc', 'fr.mayon.owner', 'fr.malolos.assoc', 'fr.malolos.owner', 'custom.user', 'acct.head', 'acct.assoc', 'hr.staff', 'field.auditor', 'exec.assistant', 'ecomm.assoc', 'sales.manager', 'agent.jerick', 'franchise.coord', 'asst.franchise.coord'];

async function main() {
  const all = flags.includes('--all-demo');
  const names = all ? DEMO : args.slice(0, 1);
  const password = (all ? args[0] : args[1]) || 'ChangeMe!2026';
  if (!names.length) { console.log('Usage: pnpm reset-password <username> [new password] [--totp]  |  pnpm reset-password --all-demo [new password]'); process.exit(1); }
  const hash = await argon2.hash(password);
  for (const username of names) {
    const u = await prisma.user.findUnique({ where: { username } });
    if (!u) { console.log(`not found: ${username}`); continue; }
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: hash, active: true, mustChangePassword: false, ...(flags.includes('--totp') || all ? { totpEnabled: false, totpSecret: null } : {}) } });
    console.log(`reset: ${username}`);
  }
  console.log(`New password: ${password}${flags.includes('--totp') || all ? ' (authenticator codes cleared: set up again at the next sign-in)' : ''}`);
}
main().finally(() => prisma.$disconnect());
