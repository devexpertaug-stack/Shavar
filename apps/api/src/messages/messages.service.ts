import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { canSendOutbound, type AuthUser, type OutboundKind } from '@estateflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService, QUEUES } from '../queue/queue.service';
import { canSeeAllLeads } from '../leads/scope';
import type { SendMessageDto } from './dto';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  private assertCanAccess(user: AuthUser, assignedTo: string | null): void {
    if (canSeeAllLeads(user.role)) return;
    if (assignedTo !== user.id) throw new ForbiddenException('Lead not assigned to you');
  }

  /** Conversation list: most-recently-active leads with a last-message preview. */
  async conversations(user: AuthUser) {
    return this.prisma.withTenant(user.tenantId, async (tx) => {
      const leads = await tx.lead.findMany({
        where: canSeeAllLeads(user.role) ? {} : { assignedTo: user.id },
        include: {
          contact: true,
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      });
      return leads.map((l) => ({
        leadId: l.id,
        contact: { name: l.contact.name, phoneE164: l.contact.phoneE164, optedIn: l.contact.optedIn },
        stage: l.stage,
        tier: l.tier,
        lastInboundAt: l.lastInboundAt,
        lastMessage: l.messages[0] ?? null,
        aiActive: l.aiActive,
      }));
    });
  }

  async thread(user: AuthUser, leadId: string, limit: number) {
    return this.prisma.withTenant(user.tenantId, async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id: leadId }, include: { contact: true } });
      if (!lead) throw new NotFoundException('Lead not found');
      this.assertCanAccess(user, lead.assignedTo);
      const messages = await tx.message.findMany({
        where: { leadId },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
      return {
        lead: {
          id: lead.id,
          stage: lead.stage,
          tier: lead.tier,
          aiActive: lead.aiActive,
          lastInboundAt: lead.lastInboundAt,
          contact: {
            name: lead.contact.name,
            phoneE164: lead.contact.phoneE164,
            optedIn: lead.contact.optedIn,
          },
        },
        messages,
      };
    });
  }

  /**
   * Send an outbound message from the CRM. Enforces the 24-hour window (FR-4):
   * outside it only templates are allowed, and never to an opted-out contact.
   * Persists a `queued` OUTBOUND row then enqueues the actual send.
   */
  async send(user: AuthUser, leadId: string, dto: SendMessageDto) {
    if (dto.kind === 'text' && !dto.text) throw new BadRequestException('text is required');
    if (dto.kind === 'media' && !dto.mediaUrl) throw new BadRequestException('mediaUrl is required');
    if (dto.kind === 'template' && !dto.templateName)
      throw new BadRequestException('templateName is required');

    const stored = await this.prisma.withTenant(user.tenantId, async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id: leadId }, include: { contact: true } });
      if (!lead) throw new NotFoundException('Lead not found');
      this.assertCanAccess(user, lead.assignedTo);

      if (!lead.contact.optedIn) {
        throw new BadRequestException('Contact has opted out of messages');
      }
      const windowCheck = canSendOutbound(dto.kind as OutboundKind, lead.lastInboundAt);
      if (!windowCheck.ok) throw new BadRequestException(windowCheck.reason);

      const message = await tx.message.create({
        data: {
          tenantId: user.tenantId,
          leadId,
          direction: 'OUTBOUND',
          type: dto.kind === 'media' ? 'image' : dto.kind === 'template' ? 'template' : 'text',
          body: dto.text ?? null,
          mediaUrl: dto.mediaUrl ?? null,
          status: 'queued',
          sentBy: 'user',
          userId: user.id,
        },
      });
      await tx.activity.create({
        data: {
          tenantId: user.tenantId,
          leadId,
          type: 'MESSAGE',
          userId: user.id,
          payload: { direction: 'OUTBOUND', kind: dto.kind, messageId: message.id },
        },
      });
      return { message, phone: lead.contact.phoneE164 };
    });

    await this.queue.enqueue(QUEUES.OUTBOUND, 'send', {
      tenantId: user.tenantId,
      messageId: stored.message.id,
      to: stored.phone,
      kind: dto.kind,
      text: dto.text,
      mediaUrl: dto.mediaUrl,
      templateName: dto.templateName,
      templateParams: dto.templateParams,
    });

    return stored.message;
  }
}
