/**
 * Prisma seed. Task 1 seeds a demo tenant; Task 2 extends this to seed one user
 * per RBAC role. Run with: pnpm db:seed
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      name: 'Demo Realty',
      slug: 'demo',
      plan: 'GROWTH',
      settings: { country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata' },
    },
  });
  // eslint-disable-next-line no-console
  console.log(`Seeded tenant: ${tenant.name} (${tenant.id})`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
