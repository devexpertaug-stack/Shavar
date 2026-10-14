import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@estateflow/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: AuthUser) {
    return this.prisma.withTenant(user.tenantId, (tx) =>
      tx.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
  }

  async markRead(user: AuthUser, id: string) {
    await this.prisma.withTenant(user.tenantId, (tx) =>
      tx.notification.updateMany({ where: { id, userId: user.id }, data: { readAt: new Date() } }),
    );
    return { ok: true };
  }
}
