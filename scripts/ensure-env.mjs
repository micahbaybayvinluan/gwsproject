// Creates api/.env from .env.example when it is missing (the app cannot start without it).
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'api', '.env');
if (!existsSync(target)) { copyFileSync(join(root, '.env.example'), target); console.log('Created api/.env from .env.example (default settings for testing).'); }
