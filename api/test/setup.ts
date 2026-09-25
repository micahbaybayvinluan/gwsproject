import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
// Load api/.env for local runs when DATABASE_URL isn't provided by CI.
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
process.env.NODE_ENV = 'test';
process.env.PDF_FORCE_HTML ??= 'true'; // e2e reads the form text; real PDF output is checked by hand
