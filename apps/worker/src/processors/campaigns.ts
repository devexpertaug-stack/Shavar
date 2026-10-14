import type { Job } from 'bullmq';
import { withTenant } from '../prisma';
import { enqueue, QUEUES } from '../producer';
import { logger } from '../logger';

/**
 * Campaigns queue processor. Handles site-visit reminders (Task 13) and, later,
 * broadcast/sequence dispatch (Task 15). Dispatches by job name.
 */
export async function processCampaigns(job: Job): Promise<{ ok: boolean }> {
  if (job.name === 'visit-reminder') return visitReminder(job);
  return { ok: true };
}

async function visitReminder(job: Job): Promise<{ ok: boolean }> {
  const { tenantId, visitId, label } = job.data as { tenantId: string; visitId: string; label: string };

  const send = await withTenant(tenantId, async (tx) => {
    const visit = await tx.siteVisit.findUnique({ where: { id: visitId } });
    if (!visit || visit.status === 'CANCELLED') return null;

    const lead = await tx.lead.findUnique({ where: { id: visit.leadId }, include: { contact: true } });
    if (!lead) return null;

    const when = new Date(visit.slotAt).toLocaleString('en-IN');
    const body = `Reminder: your site visit is scheduled for ${when}. See you there!`;
    const msg = await tx.message.create({
      data: {
        tenantId,
        leadId: visit.leadId,
        direction: 'OUTBOUND',
        type: 'text',
        body,
        status: 'queued',
        sentBy: 'system',
      },
    });
    const sent = (visit.remindersSent as string[]) ?? [];
    await tx.siteVisit.update({
      where: { id: visitId },
      data: { remindersSent: [...sent, label] },
    });
    return { messageId: msg.id, to: lead.contact.phoneE164, body };
  });

  if (send) {
    await enqueue(QUEUES.OUTBOUND, 'send', {
      tenantId,
      messageId: send.messageId,
      to: send.to,
      kind: 'text',
      text: send.body,
    });
    logger.info({ tenantId, visitId, label }, 'sent visit reminder');
  }
  return { ok: true };
}
