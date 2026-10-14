import { BadRequestException, Injectable } from '@nestjs/common';
import { RoutingActionSchema, RoutingConditionSchema } from '@estateflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { UpsertRoutingRuleDto } from './dto';

@Injectable()
export class RoutingService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.routingRule.findMany({ orderBy: { priority: 'asc' } }),
    );
  }

  async create(tenantId: string, dto: UpsertRoutingRuleDto) {
    // Validate the JSON shapes against the shared zod schemas.
    const parsedCond = RoutingConditionSchema.safeParse(dto.conditions);
    const parsedAction = RoutingActionSchema.safeParse(dto.action);
    if (!parsedCond.success) throw new BadRequestException('Invalid conditions');
    if (!parsedAction.success) throw new BadRequestException('Invalid action');

    return this.prisma.withTenant(tenantId, (tx) =>
      tx.routingRule.create({
        data: {
          tenantId,
          name: dto.name,
          priority: dto.priority ?? 100,
          conditions: parsedCond.data,
          action: parsedAction.data,
          isActive: dto.isActive ?? true,
        },
      }),
    );
  }

  async update(tenantId: string, id: string, dto: UpsertRoutingRuleDto) {
    const parsedCond = RoutingConditionSchema.safeParse(dto.conditions);
    const parsedAction = RoutingActionSchema.safeParse(dto.action);
    if (!parsedCond.success) throw new BadRequestException('Invalid conditions');
    if (!parsedAction.success) throw new BadRequestException('Invalid action');
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.routingRule.update({
        where: { id },
        data: {
          name: dto.name,
          priority: dto.priority ?? 100,
          conditions: parsedCond.data,
          action: parsedAction.data,
          isActive: dto.isActive ?? true,
        },
      }),
    );
  }

  remove(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.routingRule.deleteMany({ where: { id } }));
  }
}
