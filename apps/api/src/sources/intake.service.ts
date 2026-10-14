import { Injectable } from '@nestjs/common';
import { normalizePhoneE164, type NormalizedLead } from '@estateflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService, QUEUES } from '../queue/queue.service';

@Injectable()
export class IntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Ingest a normalized lead (FR-2/FR-3): dedup by E.164 across all sources —
   * a repeat enquiry merges into the existing lead with an ENQUIRY event rather
   * than creating a duplicate — then fire a welcome template within seconds.
   */
  async ingest(tenantId: string, lead: NormalizedLead): Promise<{ leadId: string; merged: boolean }> {
    const phoneE164 = lead.phone ? normalizePhoneE164(lead.phone) : null;
    if (!phoneE164) return { leadId: '', merged: false };

    const result = await this.prisma.withTenant(tenantId, async (tx) => {
      const contact = await tx.contact.upsert({
        where: { tenantId_phoneE164: { tenantId, phoneE164 } },
        update: lead.name ? { name: lead.name } : {},
        create: { tenantId, phoneE164, name: lead.name ?? null },
      });

      const existing = await tx.lead.findFirst({
        where: { contactId: contact.id },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        await tx.activity.create({
          data: {
            tenantId,
            leadId: existing.id,
            type: 'ENQUIRY',
            payload: { note: `Repeat enquiry via ${lead.source}`, source: lead.source },
          },
        });
        return { leadId: existing.id, merged: true, phone: phoneE164, isNew: false };
      }

      const created = await tx.lead.create({
        data: {
          tenantId,
          contactId: contact.id,
          source: lead.source,
          campaignId: lead.campaignId ?? null,
          attribution: (lead.attribution ?? undefined) as object | undefined,
          stage: 'New',
        },
      });
      await tx.activity.create({
        data: { tenantId, leadId: created.id, type: 'ENQUIRY', payload: { note: `New lead via ${lead.source}` } },
      });
      return { leadId: created.id, merged: false, phone: phoneE164, isNew: true };
    });

    if (!result.leadId) return { leadId: '', merged: false };

    // Fire an instant welcome template (new leads only) — within 60s (FR-2).
    if (result.isNew) {
      const welcome = await this.prisma.withTenant(tenantId, async (tx) => {
        const tpl = await tx.template.findFirst({ where: { name: 'welcome' } });
        const msg = await tx.message.create({
          data: {
            tenantId,
            leadId: result.leadId,
            direction: 'OUTBOUND',
            type: tpl ? 'template' : 'text',
            body: tpl ? null : 'Hi! Thanks for your interest — how can we help you find your home?',
            status: 'queued',
            sentBy: 'system',
          },
        });
        return { messageId: msg.id, templateName: tpl?.name };
      });
      await this.queue.enqueue(QUEUES.OUTBOUND, 'send', {
        tenantId,
        messageId: welcome.messageId,
        to: result.phone,
        kind: welcome.templateName ? 'template' : 'text',
        templateName: welcome.templateName,
        templateParams: [lead.name ?? 'there'],
        text: welcome.templateName ? undefined : 'Hi! Thanks for your interest — how can we help you find your home?',
      });
    }

    return { leadId: result.leadId, merged: result.merged };
  }
}
