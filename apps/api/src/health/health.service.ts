import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { DependencyHealth, HealthResponse, HealthStatus } from '@estateflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.constants';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private async timed(probe: () => Promise<unknown>): Promise<DependencyHealth> {
    const start = Date.now();
    try {
      await probe();
      return { status: 'up', latencyMs: Date.now() - start };
    } catch (err) {
      return { status: 'down', latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }

  async check(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([
      this.timed(() => this.prisma.ping()),
      this.timed(() => this.redis.ping()),
    ]);

    const downCount = [database, redis].filter((d) => d.status === 'down').length;
    const status: HealthStatus = downCount === 0 ? 'ok' : downCount === 2 ? 'error' : 'degraded';

    return {
      status,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.1.0',
      dependencies: { database, redis },
    };
  }
}
