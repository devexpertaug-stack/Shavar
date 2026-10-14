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
  if (job.name === 'broadcast') return broadcast(job);
  return { ok: true };
}

/**
 * Broadcast dispatch (FR-23): send the campaign template to each PENDING
 * recipient, honoring opt-out (re-checked at send time) and a per-minute rate
 * limit. Remaining recipients are deferred to a follow-up job.
 */
async function broadcast(job: Job): Promise<{ ok: boolean }> {
  const { tenantId, campaignId } = job.data as { tenantId: string; campaignId: string };
  const perMinute = Number(process.env.BROADCAST_RATE_PER_MIN ?? 60);

  const { sent, remaining, templateName } = await withTenant(tenantId, async (tx) => {
    const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return { sent: 0, remaining: 0, templateName: '' };

    const pending = await tx.campaignRecipient.findMany({
      where: { campaignId, status: 'PENDING' },
      take: perMinute,
    });
    let sent = 0;
    for (const r of pending) {
      const lead = await tx.lead.findUnique({ where: { id: r.leadId }, include: { contact: true } });
      // Re-check opt-out at send time.
      if (!lead || !lead.contact.optedIn) {
        await tx.campaignRecipient.update({ where: { id: r.id }, data: { status: 'SKIPPED' } });
        continue;
      }
      const msg = await tx.message.create({
        data: {
          tenantId,
          leadId: r.leadId,
          direction: 'OUTBOUND',
          type: 'template',
          status: 'queued',
          sentBy: 'system',
        },
      });
      await tx.campaignRecipient.update({ where: { id: r.id }, data: { status: 'SENT' } });
      await enqueue(QUEUES.OUTBOUND, 'send', {
        tenantId,
        messageId: msg.id,
        to: lead.contact.phoneE164,
        kind: 'template',
        templateName: campaign.templateName,
        templateParams: [lead.contact.name ?? 'there'],
      });
      sent++;
    }
    const remaining = await tx.campaignRecipient.count({ where: { campaignId, status: 'PENDING' } });
    if (remaining === 0) {
      await tx.campaign.update({ where: { id: campaignId }, data: { status: 'COMPLETED' } });
    }
    return { sent, remaining, templateName: campaign.templateName };
  });

  // Defer the next batch ~1 min later to respect the rate limit.
  if (remaining > 0) {
    await enqueue(QUEUES.CAMPAIGNS, 'broadcast', { tenantId, campaignId }, undefined, { delay: 60_000 });
  }
  logger.info({ tenantId, campaignId, sent, remaining, templateName }, 'broadcast batch');
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
