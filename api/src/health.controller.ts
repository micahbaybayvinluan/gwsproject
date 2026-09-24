import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators';

@Controller('api/health')
export class HealthController {
  @Public() @Get() health() { return { ok: true, time: new Date().toISOString() }; }
}
