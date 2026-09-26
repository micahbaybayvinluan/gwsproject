import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../common/decorators';
import type { SessionUser } from '../common/request-context';
import { Z } from '../common/zod.pipe';
import { HelpService } from './help.service';

const Ask = z.object({ question: z.string().trim().min(3).max(1000), history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).max(12).optional() });

/** Every signed-in person can read the guide sections for their role and ask questions. */
@Controller('api/help')
export class HelpController {
  constructor(private svc: HelpService) {}
  @Get() sections(@CurrentUser() u: SessionUser) { return this.svc.sections(u); }
  @Post('ask') ask(@Body(Z(Ask)) dto: z.infer<typeof Ask>, @CurrentUser() u: SessionUser) { return this.svc.ask(dto.question, dto.history ?? [], u); }
}
