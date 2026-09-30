import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { randomBytes } from 'node:crypto';

export interface SessionData {
  userId: string;
  roleKey: string;
  totpVerified: boolean;
  idleSeconds: number;
  createdAt: number;
  ip?: string;
  userAgent?: string;
}

/** Server-side sessions in Redis with sliding idle expiry (§3). */
@Injectable()
export class SessionStore implements OnModuleDestroy {
  readonly redis: Redis;
  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 3, lazyConnect: false });
  }
  private key(id: string) { return `sess:${id}`; }
  private userKey(userId: string) { return `sess:user:${userId}`; }

  async create(data: SessionData): Promise<string> {
    const id = randomBytes(32).toString('base64url');
    await this.redis.set(this.key(id), JSON.stringify(data), 'EX', data.idleSeconds);
    await this.redis.sadd(this.userKey(data.userId), id);
    return id;
  }
  async get(id: string): Promise<SessionData | null> {
    const raw = await this.redis.get(this.key(id));
    if (!raw) return null;
    const data = JSON.parse(raw) as SessionData;
    await this.redis.expire(this.key(id), data.idleSeconds); // sliding window
    return data;
  }
  async update(id: string, patch: Partial<SessionData>) {
    const cur = await this.get(id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    await this.redis.set(this.key(id), JSON.stringify(next), 'EX', next.idleSeconds);
  }
  async destroy(id: string) {
    const cur = await this.get(id);
    await this.redis.del(this.key(id));
    if (cur) await this.redis.srem(this.userKey(cur.userId), id);
  }
  async destroyAllForUser(userId: string) {
    const ids = await this.redis.smembers(this.userKey(userId));
    if (ids.length) await this.redis.del(...ids.map((i) => this.key(i)));
    await this.redis.del(this.userKey(userId));
  }
  async listForUser(userId: string): Promise<string[]> { return this.redis.smembers(this.userKey(userId)); }
  /** Tombstone for a session ended because the same account signed in elsewhere (so the old device can be told why). */
  async markReplaced(id: string) { await this.redis.set(`sess:replaced:${id}`, '1', 'EX', 7 * 86400); }
  async wasReplaced(id: string) { return (await this.redis.exists(`sess:replaced:${id}`)) === 1; }
  onModuleDestroy() { this.redis.disconnect(); }
}
