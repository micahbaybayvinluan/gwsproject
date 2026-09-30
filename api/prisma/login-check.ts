/**
 * "Why can't I log in?" check for the owner's Mac. Run from the gws-erp folder:
 *   pnpm login-check          → checks settings, database, Redis, the API and the web page, and tries a login
 *   pnpm login-check --reset  → also resets every demo account (…@gws.local) to password ChangeMe!2026, active, no authenticator
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';

const DEMO_PASSWORD = 'ChangeMe!2026';
const reset = process.argv.includes('--reset');
const ok = (m: string) => console.log(`  OK    ${m}`);
const bad = (m: string, fix: string) => { console.log(`  PROBLEM  ${m}\n           Fix: ${fix}`); problems++; };
let problems = 0;

async function main() {
  console.log('\nGWS-ERP check\n');
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) { bad('api/.env is missing', 'in the gws-erp folder run:  cp .env.example api/.env'); return; }
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim(); }
  ok('api/.env found');
  if (process.env.AUTH_TOTP_OPTIONAL === 'true') ok('authenticator codes are switched off for testing (AUTH_TOTP_OPTIONAL=true)');
  else bad('authenticator codes are switched ON, so Admin and the auditors are asked for a 6-digit code', 'open api/.env, set the line to  AUTH_TOTP_OPTIONAL=true , save, stop the app (Control+C) and run  pnpm dev  again');

  const prisma = new PrismaClient();
  try { await prisma.$queryRaw`SELECT 1`; ok('database is running'); }
  catch (e) { bad(`cannot reach the database (${(e as Error).message.split('\n').filter(Boolean).pop()})`, 'open Docker Desktop and wait until it says "running", then in the gws-erp folder run:  docker compose up -d postgres redis'); await prisma.$disconnect(); return; }

  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
  try { await redis.connect(); await redis.ping(); ok('Redis (sign-in sessions) is running'); }
  catch { bad('Redis is not running, so nobody can stay signed in', 'open Docker Desktop, then run:  docker compose up -d postgres redis'); }
  finally { redis.disconnect(); }

  const demo = await prisma.user.findMany({ where: { email: { endsWith: '@gws.local' } }, select: { id: true, username: true, active: true, totpEnabled: true, mustChangePassword: true, passwordHash: true } });
  if (!demo.length) bad('there are no demo accounts in the database', 'run:  pnpm --filter @gws/api prisma:seed');
  else {
    if (reset) {
      const hash = await argon2.hash(DEMO_PASSWORD);
      await prisma.user.updateMany({ where: { id: { in: demo.map((u) => u.id) } }, data: { passwordHash: hash, active: true, totpEnabled: false, totpSecret: null, mustChangePassword: false } });
      ok(`reset ${demo.length} demo accounts to password ${DEMO_PASSWORD} (active, no authenticator)`);
    } else {
      const admin = demo.find((u) => u.username === 'admin');
      if (admin && !(await argon2.verify(admin.passwordHash, DEMO_PASSWORD).catch(() => false))) bad(`the admin password is no longer ${DEMO_PASSWORD} (it was changed in the app)`, 'run:  pnpm login-check --reset');
      else ok(`admin password is ${DEMO_PASSWORD}`);
      const off = demo.filter((u) => !u.active).map((u) => u.username);
      if (off.length) bad(`these accounts are switched off: ${off.join(', ')}`, 'run:  pnpm login-check --reset');
    }
  }
  await prisma.$disconnect();

  try { const r = await fetch('http://localhost:4000/api/health'); if (!r.ok) throw new Error(String(r.status)); ok('the app server (API) is running on port 4000'); }
  catch { bad('the app server (API) is not running', 'in the gws-erp folder run:  pnpm dev   and leave that window open (scroll up in it for red error lines if it stops)'); return; }
  try { const r = await fetch('http://localhost:5173/'); if (!r.ok) throw new Error(String(r.status)); ok('the web page is running on http://localhost:5173'); }
  catch { bad('the web page is not running', 'run:  pnpm dev   in the gws-erp folder'); }
  const r = await fetch('http://localhost:4000/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: DEMO_PASSWORD }) });
  const body = (await r.json().catch(() => ({}))) as { totpRequired?: boolean; message?: string };
  if (r.ok && !body.totpRequired) ok('test sign-in as admin worked');
  else if (r.ok) bad('admin sign-in asks for an authenticator code', 'set AUTH_TOTP_OPTIONAL=true in api/.env and restart pnpm dev');
  else bad(`admin sign-in failed: ${body.message ?? r.status}`, 'run:  pnpm login-check --reset');
}

main().then(() => { console.log(problems ? `\n${problems} problem(s) found. Do the "Fix" steps above, then run  pnpm login-check  again.\n` : '\nEverything looks fine. Open http://localhost:5173 and sign in with admin / ChangeMe!2026\n'); process.exit(0); });
