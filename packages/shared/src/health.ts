import { z } from 'zod';

/** Shape of the GET /health response (Task 1). */
export const HealthStatus = z.enum(['ok', 'degraded', 'error']);
export type HealthStatus = z.infer<typeof HealthStatus>;

export const DependencyHealthSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative().optional(),
  error: z.string().optional(),
});
export type DependencyHealth = z.infer<typeof DependencyHealthSchema>;

export const HealthResponseSchema = z.object({
  status: HealthStatus,
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.string(),
  version: z.string(),
  dependencies: z.object({
    database: DependencyHealthSchema,
    redis: DependencyHealthSchema,
  }),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
