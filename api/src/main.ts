import 'reflect-metadata';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { requestContext } from './common/request-context';
import { RedactionInterceptor } from './common/redaction';
import { AuditInterceptor, AuditService } from './common/audit.service';
import { AuthGuard } from './auth/auth.guard';
import { AppExceptionFilter } from './common/http-exception.filter';

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'warn', 'error'] });
  // a count sheet lists every item (1,500 or more lines) and is saved in one request: the default 100 KB limit is too small
  app.useBodyParser('json', { limit: '5mb' });
  app.use(cookieParser());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    requestContext.run({ requestId: randomUUID(), ip: req.ip, userAgent: req.headers['user-agent'] }, () => next());
  });
  app.enableCors({ origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','), credentials: true });
  app.useGlobalGuards(app.get(AuthGuard));
  app.useGlobalFilters(new AppExceptionFilter());
  app.useGlobalInterceptors(new RedactionInterceptor(), new AuditInterceptor(app.get(AuditService), app.get(Reflector)));
  return app;
}

async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.PORT || 4000);
  await app.listen(port);
  new Logger('Bootstrap').log(`GWS-ERP API listening on :${port}`);
}
if (require.main === module) void bootstrap();
