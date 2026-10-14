import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HealthController } from '../src/health/health.controller';
import { HealthService } from '../src/health/health.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/redis/redis.constants';

/**
 * e2e test for GET /health (Task 1). We mock the DB and Redis probes so the
 * endpoint logic (status aggregation + HTTP code) is verified without live
 * infrastructure. The docker-compose stack exercises the real connections.
 */
describe('GET /health (e2e)', () => {
  let app: INestApplication;
  const prismaMock = { ping: async () => undefined };
  const redisMock = { ping: async () => 'PONG' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: REDIS_CLIENT, useValue: redisMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 and status ok when both deps are up', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.dependencies.database.status).toBe('up');
    expect(res.body.dependencies.redis.status).toBe('up');
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('returns 503 and status degraded when redis is down', async () => {
    redisMock.ping = async () => {
      throw new Error('connection refused');
    };
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.dependencies.redis.status).toBe('down');
    expect(res.body.dependencies.database.status).toBe('up');
    // restore for isolation
    redisMock.ping = async () => 'PONG';
  });

  it('returns 503 and status error when both deps are down', async () => {
    prismaMock.ping = async () => {
      throw new Error('db down');
    };
    redisMock.ping = async () => {
      throw new Error('redis down');
    };
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
    prismaMock.ping = async () => undefined;
    redisMock.ping = async () => 'PONG';
  });
});
