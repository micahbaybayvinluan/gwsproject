import { ForbiddenException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { requestContext } from './request-context';

/** Models that carry a location_id and must be filtered for location-scoped users (§3 rule 2, §5.4). */
const SCOPED_MODELS: Record<string, string[]> = {
  StockLedger: ['locationId'],
  StockBalance: ['locationId'],
  ReceivingDoc: ['locationId'],
  TransferDoc: ['fromLocationId', 'toLocationId', 'OR'],
  SalesDoc: ['locationId'],
  ExpenseDoc: ['locationId'],
  CountDoc: ['locationId'],
  ExpiryWriteoffDoc: ['locationId'],
  DailyClose: ['locationId'],
  FranchiseExpense: ['locationId'],
  MinStockLevel: ['locationId'],
};
const READ_OPS = new Set(['findMany', 'findFirst', 'count', 'aggregate', 'groupBy', 'findFirstOrThrow']);

function hasScopeFilter(where: Record<string, unknown> | undefined, fields: string[]): boolean {
  if (!where) return false;
  for (const f of fields) if (f in where && where[f] !== undefined) return true;
  if (Array.isArray(where.AND)) return (where.AND as Record<string, unknown>[]).some((w) => hasScopeFilter(w, fields));
  return false;
}

export function createScopedClient() {
  const base = new PrismaClient({ log: process.env.PRISMA_LOG ? ['query', 'warn', 'error'] : ['warn', 'error'] });
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = requestContext.get();
          const fields = SCOPED_MODELS[model as string];
          if (ctx?.user?.locationScoped && fields && READ_OPS.has(operation)) {
            const where = (args as { where?: Record<string, unknown> }).where;
            if (!hasScopeFilter(where, fields)) {
              throw new ForbiddenException(`Query on ${model} without a location scope filter (branch scoping is mandatory)`);
            }
          }
          return query(args);
        },
      },
    },
  });
}
export type ScopedPrisma = ReturnType<typeof createScopedClient>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: ScopedPrisma;
  constructor() { this.client = createScopedClient(); }
  async onModuleInit() { await this.client.$connect(); }
  async onModuleDestroy() { await this.client.$disconnect(); }
  get db() { return this.client; }
}
