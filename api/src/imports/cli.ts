/* eslint-disable no-console */
/** CLI: `pnpm import:products /seed/inventory.xlsm` and `pnpm import:coa /seed/ACCTG\ PROGRAM\ -\ FORMAT.xlsm` (runs as admin, no HTTP). */
import 'reflect-metadata';
import * as fs from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ImportsService } from './imports.service';
import { PrismaService } from '../common/prisma.service';
import { AuthService } from '../auth/auth.service';
import { requestContext } from '../common/request-context';
import { LOCATION_SCOPED_ROLES, effectivePermissions } from '../common/permissions';

async function main() {
  const [kind, file] = process.argv.slice(2);
  if (!kind || !file) { console.error('usage: cli.ts <products|coa> <file.xlsx>'); process.exit(1); }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService); const imports = app.get(ImportsService); void app.get(AuthService);
  const admin = await prisma.db.user.findFirstOrThrow({ where: { role: { key: 'ADMIN' } }, include: { role: true, permissionOverrides: true, assignments: true } });
  const user = { id: admin.id, username: admin.username, fullName: admin.fullName, roleKey: 'ADMIN', permissions: effectivePermissions(admin.role.permissions as string[], admin.permissionOverrides), locationIds: admin.assignments.map((a) => a.locationId), locationScoped: LOCATION_SCOPED_ROLES.includes('ADMIN'), sessionId: 'cli', totpVerified: true };
  const buf = fs.readFileSync(file);
  await requestContext.run({ requestId: 'cli', user }, async () => {
    if (kind === 'products') console.log(await imports.productsFromSeedWorkbook(buf, user));
    else if (kind === 'coa') {
      const rows = [...(await imports.coaPreview(buf, 'BALANCE SHEET')), ...(await imports.coaPreview(buf, 'INCOME STATEMENT'))];
      console.log(`Parsed ${rows.length} accounts; committing with parsed tags (review in UI to override)…`);
      console.log(await imports.coaCommit(rows.map((r) => ({ ...r, class: r.class as never })), Number(process.env.FISCAL_YEAR_START?.slice(0, 4) ?? 2026), user));
    } else console.error('unknown kind');
  });
  await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
