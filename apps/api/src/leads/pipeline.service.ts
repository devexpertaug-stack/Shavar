import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DEFAULT_STAGES, LOST_STAGE, BOOKED_STAGE } from '@estateflow/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PipelineService {
  constructor(private readonly prisma: PrismaService) {}

  /** Create the default stage set for a tenant if none exist. Idempotent. */
  async ensureStages(tenantId: string): Promise<void> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const count = await tx.pipelineStage.count();
      if (count > 0) return;
      await tx.pipelineStage.createMany({
        data: DEFAULT_STAGES.map((name, order) => ({
          tenantId,
          name,
          order,
          isTerminal: name === LOST_STAGE || name === BOOKED_STAGE,
        })),
      });
    });
  }

  async list(tenantId: string) {
    await this.ensureStages(tenantId);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.pipelineStage.findMany({ orderBy: { order: 'asc' } }),
    );
  }

  /** Stage names in order — used by stage-transition validation. */
  async stageNames(tx: Prisma.TransactionClient): Promise<string[]> {
    const stages = await tx.pipelineStage.findMany({ orderBy: { order: 'asc' } });
    return stages.map((s) => s.name);
  }
}
