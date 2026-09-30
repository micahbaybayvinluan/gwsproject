import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** Maps Prisma errors to meaningful HTTP responses (unique violations → 409, missing rows → 404) and logs the rest. */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private log = new Logger('Http');
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) { res.status(exception.getStatus()).json(exception.getResponse()); return; }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') { res.status(HttpStatus.CONFLICT).json({ statusCode: 409, message: `Duplicate value for ${(exception.meta?.target as string[] | undefined)?.join(', ') ?? 'unique field'}`, code: 'DUPLICATE' }); return; }
      if (exception.code === 'P2025') { res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, message: 'Record not found' }); return; }
      if (exception.code === 'P2003') { res.status(HttpStatus.BAD_REQUEST).json({ statusCode: 400, message: 'Referenced record does not exist' }); return; }
    }
    this.log.error((exception as Error)?.stack ?? String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, message: 'Internal server error' });
  }
}
