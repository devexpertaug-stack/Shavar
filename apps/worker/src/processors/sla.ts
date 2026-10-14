import type { Job } from 'bullmq';
import type IORedis from 'ioredis';
import { withTenant } from '../prisma';
import { publishRealtime } from '../realtime-publisher';
import { logger } from '../logger';

interface SlaJob {
  tenantId: string;
  leadId: string;
  assignedTo: string | null;
}

/**
 * SLA escalation (FR-12). Fired after a delay for a Hot lead: if the lead was
 * not contacted (no OUTBOUND message or CALL activity since assignment) and is
 * still assigned to the same person, escalate to a Sales Manager and reassign.
 */
export async function processSla(job: Job, redis: IORedis): Promise<{ ok: boolean }> {
  const { tenantId, leadId, assignedTo } = job.data as SlaJob;

  const escalated = await withTenant(tenantId, async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: leadId } });
    if (!lead || lead.assignedTo !== assignedTo) return null; // already moved on

    const contacted = await tx.message.count({
      where: { leadId, direction: 'OUTBOUND' },
    });
    const called = await tx.activity.count({ where: { leadId, type: 'CALL' } });
    if (contacted > 0 || called > 0) return null; // SLA met

    const manager = await tx.user.findFirst({
      where: { role: 'SALES_MANAGER', isActive: true },
    });

    await tx.lead.update({
      where: { id: leadId },
      data: { assignedTo: manager?.id ?? null },
    });
    await tx.activity.create({
      data: {
        tenantId,
        leadId,
        type: 'ASSIGNMENT',
        payload: { escalation: true, from: assignedTo, to: manager?.id ?? null, reason: 'SLA breach' },
      },
    });
    if (manager) {
      await tx.notification.create({
        data: {
          tenantId,
          userId: manager.id,
          type: 'SLA_ESCALATION',
          title: 'Hot lead SLA breached — escalated to you',
          leadId,
        },
      });
    }
    return { managerId: manager?.id ?? null };
  });

  if (escalated?.managerId) {
    await publishRealtime(redis, {
      tenantId,
      userId: escalated.managerId,
      event: 'notification:new',
      payload: { leadId, type: 'SLA_ESCALATION' },
    });
    logger.info({ tenantId, leadId }, 'SLA breach escalated to manager');
  }
  return { ok: true };
}
