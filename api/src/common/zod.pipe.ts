import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private schema: ZodSchema<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) throw new BadRequestException({ message: 'Validation failed', issues: r.error.issues });
    return r.data;
  }
}
export const Z = <T>(schema: ZodSchema<T>) => new ZodPipe(schema);
