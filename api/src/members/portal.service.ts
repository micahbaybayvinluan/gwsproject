import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../common/prisma.service';
import { MembersService } from './members.service';
import { emailKeyOf, phoneKeyOf, qrValue, signToken, verifyToken } from './members.util';
import { dateStr } from '../common/manila';

export interface SignupInput { fullName: string; phone: string; email?: string; password: string; birthday?: string; memberNo?: string; emailOptIn?: boolean; smsOptIn?: boolean; agree: boolean }

/**
 * The Wheysted portal for customers (owner request 2026-10-03): sign up, sign in, show the QR card at the counter and see their own
 * purchases. A customer's own sign-up never pulls in past sales by phone number (anyone could type someone else's number); a person
 * the store already made a member claims that account with their member number and the number the store has on file.
 */
@Injectable()
export class PortalService {
  private tries = new Map<string, { n: number; until: number }>();
  constructor(private prisma: PrismaService, private members: MembersService) {}

  private throttle(key: string) { const t = this.tries.get(key); if (t && t.n >= 6 && t.until > Date.now()) throw new BadRequestException('Too many tries. Wait 15 minutes and try again.'); }
  private fail(key: string) { const t = this.tries.get(key); const n = (t && t.until > Date.now() ? t.n : 0) + 1; this.tries.set(key, { n, until: Date.now() + 15 * 60000 }); }
  private ok(key: string) { this.tries.delete(key); }
  private session(id: string) { return signToken({ m: id }, 30); }
  memberFromToken(token: string | undefined) { const p = verifyToken<{ m: string }>(token); if (!p?.m) throw new UnauthorizedException('Please sign in'); return p.m; }

  async signup(input: SignupInput) {
    if (!input.agree) throw new BadRequestException('Please tick that you agree to the membership terms');
    if ((input.password ?? '').length < 8) throw new BadRequestException('The password needs at least 8 characters');
    const pk = phoneKeyOf(input.phone); if (!pk) throw new BadRequestException('Type your mobile number (at least 10 digits)');
    const ek = emailKeyOf(input.email);
    const existing = await this.prisma.db.member.findFirst({ where: { OR: [{ phoneKey: pk }, ...(ek ? [{ emailKey: ek }] : [])] } });
    const hash = await argon2.hash(input.password);
    if (existing) {
      if (existing.passwordHash) throw new BadRequestException('You already have an account. Please sign in (forgot your password? ask the store to reset it).');
      // the store already made this person a member: claim it with the member number
      const no = (input.memberNo ?? '').trim().toUpperCase();
      if (!no) throw new BadRequestException('The store already has you as a member. Type your member number (WHY-…, from the store or your receipt) to open your account.');
      this.throttle(`claim:${pk}`);
      if (no !== existing.memberNo || existing.phoneKey !== pk) { this.fail(`claim:${pk}`); throw new BadRequestException('That member number does not match this mobile number.'); }
      this.ok(`claim:${pk}`);
      const m = await this.prisma.db.member.update({ where: { id: existing.id }, data: { passwordHash: hash, email: existing.email ?? input.email?.trim() ?? null, emailKey: existing.emailKey ?? ek, consentAt: new Date(), emailOptIn: input.emailOptIn ?? existing.emailOptIn, smsOptIn: input.smsOptIn ?? existing.smsOptIn, lastLoginAt: new Date() } });
      return { token: this.session(m.id), claimed: true };
    }
    const m = await this.members.create({ fullName: input.fullName, phone: input.phone, email: input.email, birthday: input.birthday, emailOptIn: input.emailOptIn, smsOptIn: input.smsOptIn, consent: true }, { source: 'PORTAL', passwordHash: hash });
    await this.prisma.db.member.update({ where: { id: m.id }, data: { lastLoginAt: new Date() } });
    return { token: this.session(m.id), claimed: false };
  }

  async login(identifier: string, password: string) {
    const id = identifier.trim(); const key = `login:${id.toLowerCase()}`; this.throttle(key);
    const pk = /^[\d\s+()-]+$/.test(id) ? phoneKeyOf(id) : null;
    const ek = emailKeyOf(id);
    const m = await this.prisma.db.member.findFirst({ where: { OR: [...(pk ? [{ phoneKey: pk }] : []), ...(ek ? [{ emailKey: ek }] : []), { memberNo: id.toUpperCase() }] } });
    if (!m || !m.passwordHash || m.status !== 'ACTIVE' || !(await argon2.verify(m.passwordHash, password).catch(() => false))) { this.fail(key); throw new UnauthorizedException('Wrong mobile number / email or password'); }
    this.ok(key);
    await this.prisma.db.member.update({ where: { id: m.id }, data: { lastLoginAt: new Date() } });
    return { token: this.session(m.id) };
  }

  /** My card, numbers and purchases. */
  async me(token: string | undefined) {
    const id = this.memberFromToken(token);
    const m = await this.prisma.db.member.findUnique({ where: { id } }); if (!m || m.status !== 'ACTIVE') throw new UnauthorizedException('Please sign in');
    const st = (await this.members.stats([id])).get(id);
    return { memberNo: m.memberNo, fullName: m.fullName, phone: m.phone, email: m.email, birthday: m.birthday ? dateStr(m.birthday) : null, emailOptIn: m.emailOptIn, smsOptIn: m.smsOptIn, qr: qrValue(m.qrToken), joined: dateStr(m.createdAt),
      stats: { orders: st?.orders ?? 0, spent: st?.spent ?? 0, lastPurchase: st?.lastDate ? dateStr(st.lastDate) : null, favoriteProduct: st?.favProduct ?? null }, purchases: await this.members.purchases(id, 100) };
  }

  async update(token: string | undefined, input: { fullName?: string; email?: string | null; birthday?: string | null; emailOptIn?: boolean; smsOptIn?: boolean }) {
    const id = this.memberFromToken(token);
    const m = await this.prisma.db.member.findUniqueOrThrow({ where: { id } });
    await this.members.update(null, id, { fullName: input.fullName ?? m.fullName, email: input.email === undefined ? undefined : input.email, birthday: input.birthday, emailOptIn: input.emailOptIn, smsOptIn: input.smsOptIn });
    return { ok: true };
  }

  async changePassword(token: string | undefined, current: string, next: string) {
    const id = this.memberFromToken(token);
    const m = await this.prisma.db.member.findUniqueOrThrow({ where: { id } });
    if (!m.passwordHash || !(await argon2.verify(m.passwordHash, current).catch(() => false))) throw new BadRequestException('The current password is wrong');
    if (next.length < 8) throw new BadRequestException('The new password needs at least 8 characters');
    await this.prisma.db.member.update({ where: { id }, data: { passwordHash: await argon2.hash(next) } });
    return { ok: true };
  }

  /** Link in every email / SMS: the person is taken off the lists. */
  unsubscribeToken(channel: 'EMAIL' | 'SMS', key: string) { return signToken({ c: channel, k: key }, 3650); }
  async unsubscribe(token: string) {
    const p = verifyToken<{ c: 'EMAIL' | 'SMS'; k: string }>(token); if (!p) throw new BadRequestException('This link is not valid');
    await this.prisma.db.messageOptOut.upsert({ where: { channel_key: { channel: p.c, key: p.k } }, create: { channel: p.c, key: p.k }, update: {} });
    if (p.c === 'EMAIL') await this.prisma.db.member.updateMany({ where: { emailKey: p.k }, data: { emailOptIn: false } }); else await this.prisma.db.member.updateMany({ where: { phoneKey: p.k }, data: { smsOptIn: false } });
    return { ok: true };
  }
}
