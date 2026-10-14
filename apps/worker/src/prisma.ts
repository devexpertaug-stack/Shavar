import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Worker-side Prisma client with the same RLS-scoped helper the API uses. All
 * tenant data access goes through withTenant() so Postgres RLS filters rows.
 */
export const prisma = new PrismaClient();

export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}
