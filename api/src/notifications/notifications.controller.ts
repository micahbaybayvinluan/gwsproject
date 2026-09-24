import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../common/decorators';
import type { SessionUser } from '../common/request-context';
import { PrismaService } from '../common/prisma.service';

@Controller('api/notifications')
export class NotificationsController {
  constructor(private n: NotificationsService, private prisma: PrismaService) {}
  @Get() list(@CurrentUser() u: SessionUser, @Query('unread') unread?: string) { return this.n.list(u.id, unread === '1'); }
  @Get('unread-count') async count(@CurrentUser() u: SessionUser) { return { count: await this.n.unreadCount(u.id) }; }
  @Post('read') read(@CurrentUser() u: SessionUser, @Body() body: { ids?: string[] }) { return this.n.markRead(u.id, body?.ids); }
  @Patch('digest') digest(@CurrentUser() u: SessionUser, @Body() body: { enabled: boolean }) { return this.prisma.db.user.update({ where: { id: u.id }, data: { emailDigest: !!body.enabled }, select: { emailDigest: true } }); }
}
