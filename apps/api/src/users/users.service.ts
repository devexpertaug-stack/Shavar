import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@estateflow/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async me(user: AuthUser): Promise<AuthUser> {
    const row = await this.prisma.withTenant(user.tenantId, (tx) =>
      tx.user.findUnique({ where: { id: user.id } }),
    );
    if (!row) throw new NotFoundException('User not found');
    return {
      id: row.id,
      tenantId: row.tenantId,
      email: row.email,
      name: row.name,
      role: row.role,
      teamId: row.teamId,
      languages: row.languages,
    };
  }

  /** Tenant-scoped via RLS. Returns a safe projection (no password hashes). */
  async listForTenant(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.user.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          teamId: true,
          languages: true,
          isActive: true,
          lastLoginAt: true,
        },
      }),
    );
  }
}
