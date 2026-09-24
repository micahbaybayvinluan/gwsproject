import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { COOKIE } from './auth.guard';
import { Public, CurrentUser } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { PrismaService } from '../common/prisma.service';

const LoginDto = z.object({ identifier: z.string().min(1), password: z.string().min(1) });
const TotpDto = z.object({ code: z.string().min(6).max(8) });
const ChangePwDto = z.object({ current: z.string(), next: z.string().min(10) });

@Controller('api/auth')
export class AuthController {
  constructor(private auth: AuthService, private prisma: PrismaService) {}

  @Public()
  @Post('login')
  async login(@Body(Z(LoginDto)) dto: z.infer<typeof LoginDto>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(dto.identifier, dto.password, { ip: req.ip, userAgent: req.headers['user-agent'] });
    res.cookie(COOKIE, r.sessionId, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
    return { totpRequired: r.totpRequired, totpEnrolled: r.totpEnrolled, mustChangePassword: r.mustChangePassword, token: r.sessionId };
  }

  @Post('totp/setup')
  setup(@Req() req: Request & { sessionId: string }) { return this.auth.setupTotp(req.sessionId); }

  @Post('totp/verify')
  verify(@Body(Z(TotpDto)) dto: z.infer<typeof TotpDto>, @Req() req: Request & { sessionId: string }) { return this.auth.verifyTotp(req.sessionId, dto.code); }

  @Post('logout')
  async logout(@Req() req: Request & { sessionId: string }, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.sessionId);
    res.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  }

  @Post('password')
  changePassword(@CurrentUser() user: SessionUser, @Body(Z(ChangePwDto)) dto: z.infer<typeof ChangePwDto>) { return this.auth.changePassword(user.id, dto.current, dto.next); }

  @Get('me')
  async me(@CurrentUser() user: SessionUser) {
    const locations = user.locationIds.length
      ? await this.prisma.db.location.findMany({ where: { id: { in: user.locationIds } }, select: { id: true, code: true, name: true, type: true, isSelling: true } })
      : [];
    return { id: user.id, username: user.username, fullName: user.fullName, roleKey: user.roleKey, permissions: [...user.permissions].sort(), locations, locationScoped: user.locationScoped, totpVerified: user.totpVerified };
  }
}
