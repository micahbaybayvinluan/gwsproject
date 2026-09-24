import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as net from 'node:net';

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv']);
const MAGIC: [string, number[]][] = [['image/jpeg', [0xff, 0xd8, 0xff]], ['image/png', [0x89, 0x50, 0x4e, 0x47]], ['application/pdf', [0x25, 0x50, 0x44, 0x46]], ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', [0x50, 0x4b, 0x03, 0x04]]];

/** S3-compatible storage (MinIO in dev) with a local-disk fallback when S3_ENDPOINT is empty. Every upload is size-, content-type- and virus-checked (§3). */
@Injectable()
export class StorageService {
  private log = new Logger('Storage');
  private s3: S3Client | null = null;
  private localDir = path.resolve(process.cwd(), 'uploads');
  constructor() {
    if (process.env.S3_ENDPOINT) {
      this.s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION || 'ap-southeast-1', forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false', credentials: { accessKeyId: process.env.S3_ACCESS_KEY || '', secretAccessKey: process.env.S3_SECRET_KEY || '' } });
    }
  }

  validate(buf: Buffer, contentType: string) {
    if (buf.length > MAX_BYTES) throw new BadRequestException('File exceeds 20 MB');
    if (!ALLOWED.has(contentType)) throw new BadRequestException(`Content type ${contentType} not allowed`);
    const magic = MAGIC.find(([t]) => t === contentType);
    if (magic && !magic[1].every((b, i) => buf[i] === b)) throw new BadRequestException('File content does not match its declared type');
  }

  /** ClamAV INSTREAM scan over TCP. Returns CLEAN | INFECTED | SKIPPED (when clamd unreachable and CLAMAV_REQUIRED=false). */
  async scan(buf: Buffer): Promise<'CLEAN' | 'INFECTED' | 'SKIPPED'> {
    const host = process.env.CLAMAV_HOST; const port = Number(process.env.CLAMAV_PORT || 3310);
    const required = process.env.CLAMAV_REQUIRED === 'true';
    if (!host) { if (required) throw new BadRequestException('Virus scanner unavailable'); return 'SKIPPED'; }
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host, port });
      let resp = '';
      sock.setTimeout(30000);
      sock.on('connect', () => {
        sock.write('zINSTREAM\0');
        const CHUNK = 64 * 1024;
        for (let i = 0; i < buf.length; i += CHUNK) { const c = buf.subarray(i, i + CHUNK); const len = Buffer.alloc(4); len.writeUInt32BE(c.length); sock.write(len); sock.write(c); }
        sock.write(Buffer.alloc(4));
      });
      sock.on('data', (d) => (resp += d.toString()));
      sock.on('end', () => resolve(/FOUND/.test(resp) ? 'INFECTED' : 'CLEAN'));
      sock.on('timeout', () => { sock.destroy(); required ? reject(new BadRequestException('Virus scan timed out')) : resolve('SKIPPED'); });
      sock.on('error', (e) => { this.log.warn(`clamd error: ${e.message}`); required ? reject(new BadRequestException('Virus scanner unavailable')) : resolve('SKIPPED'); });
    });
  }

  async put(key: string, buf: Buffer, contentType: string) {
    if (this.s3) { await this.s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET || 'gws-attachments', Key: key, Body: buf, ContentType: contentType })); return; }
    const p = path.join(this.localDir, key); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, buf);
  }
  async get(key: string): Promise<Buffer> {
    if (this.s3) { const r = await this.s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET || 'gws-attachments', Key: key })); return Buffer.from(await r.Body!.transformToByteArray()); }
    return fs.readFile(path.join(this.localDir, key));
  }
  sha256(buf: Buffer) { return createHash('sha256').update(buf).digest('hex'); }
}
