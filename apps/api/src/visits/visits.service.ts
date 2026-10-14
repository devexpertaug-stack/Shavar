import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  createCalendarProvider,
  generateSlots,
  type AuthUser,
  type CalendarProvider,
} from '@estateflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService, QUEUES } from '../queue/queue.service';
import { canSeeAllLeads } from '../leads/scope';

@Injectable()
export class VisitsService {
  private calendar: CalendarProvider = createCalendarProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /** Available slots for an agent over the next few days (FR-18). */
  async availableSlots(tenantId: string, agentId?: string) {
    const all = generateSlots({ days: 5 });
    if (!agentId) return all.map((s) => s.toISOString());
    const taken = await this.prisma.withTenant(tenantId, (tx) =>
      tx.siteVisit.findMany({
        where: { agentId, slotAt: { gte: new Date() }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
        select: { slotAt: true },
      }),
    );
    const takenMs = new Set(taken.map((t) => t.slotAt.getTime()));
    return all.filter((s) => !takenMs.has(s.getTime())).map((s) => s.toISOString());
  }

  /** Book a slot. Double-booking is prevented by the unique (agentId, slotAt). */
  async book(
    tenantId: string,
    input: { leadId: string; slotAt: string; agentId?: string; unitId?: string; projectId?: string },
  ) {
    const slotAt = new Date(input.slotAt);
    if (Number.isNaN(slotAt.getTime())) throw new BadRequestException('Invalid slot');

    const visit = await this.prisma.withTenant(tenantId, async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id: input.leadId } });
      if (!lead) throw new NotFoundException('Lead not found');

      if (input.agentId) {
        const clash = await tx.siteVisit.findFirst({
          where: { agentId: input.agentId, slotAt, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
        });
        if (clash) throw new ConflictException('That slot is already booked for this agent');
      }

      try {
        const created = await tx.siteVisit.create({
          data: {
            tenantId,
            leadId: input.leadId,
            agentId: input.agentId ?? null,
            unitId: input.unitId ?? null,
            projectId: input.projectId ?? null,
            slotAt,
            status: 'SCHEDULED',
          },
        });
        // Stage automation: booking moves the lead to Visit Scheduled.
        await tx.lead.update({ where: { id: input.leadId }, data: { stage: 'Visit Scheduled' } });
        await tx.activity.create({
          data: { tenantId, leadId: input.leadId, type: 'VISIT', payload: { slotAt, visitId: created.id } },
        });
        return created;
      } catch (e) {
        // Unique violation => the race lost; treat as a conflict.
        if ((e as { code?: string }).code === 'P2002') {
          throw new ConflictException('That slot is already booked');
        }
        throw e;
      }
    });

    // Calendar sync + reminder jobs (24h and 2h before).
    const cal = await this.calendar.createEvent({
      title: 'Site visit',
      startAt: slotAt,
      endAt: new Date(slotAt.getTime() + 60 * 60 * 1000),
    });
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.siteVisit.update({ where: { id: visit.id }, data: { calendarEventId: cal.eventId } }),
    );
    await this.scheduleReminders(tenantId, visit.id, slotAt);
    return visit;
  }

  private async scheduleReminders(tenantId: string, visitId: string, slotAt: Date): Promise<void> {
    const now = Date.now();
    for (const { label, offsetMs } of [
      { label: '24h', offsetMs: 24 * 3600_000 },
      { label: '2h', offsetMs: 2 * 3600_000 },
    ]) {
      const delay = slotAt.getTime() - offsetMs - now;
      if (delay <= 0) continue; // slot too soon for this reminder
      await this.queue.enqueue(
        QUEUES.CAMPAIGNS,
        'visit-reminder',
        { tenantId, visitId, label },
        { jobId: `visit-rem:${visitId}:${label}` },
      );
    }
  }

  async checkIn(user: AuthUser, visitId: string, geo: string) {
    return this.updateVisit(user, visitId, { status: 'CHECKED_IN', checkinGeo: geo, checkedInAt: new Date() });
  }

  async checkOut(user: AuthUser, visitId: string, geo: string, feedback?: string) {
    const visit = await this.updateVisit(user, visitId, {
      status: 'COMPLETED',
      checkoutGeo: geo,
      checkedOutAt: new Date(),
      feedback,
    });
    // Stage automation: completing a visit moves the lead to Visited.
    await this.prisma.withTenant(user.tenantId, async (tx) => {
      await tx.lead.update({ where: { id: visit.leadId }, data: { stage: 'Visited' } });
      // Queue a feedback request to the lead.
      const lead = await tx.lead.findUnique({ where: { id: visit.leadId }, include: { contact: true } });
      if (lead) {
        const msg = await tx.message.create({
          data: {
            tenantId: user.tenantId,
            leadId: visit.leadId,
            direction: 'OUTBOUND',
            type: 'text',
            body: 'Thanks for visiting! How was your experience? Any feedback helps us serve you better.',
            status: 'queued',
            sentBy: 'system',
          },
        });
        await this.queue.enqueue(QUEUES.OUTBOUND, 'send', {
          tenantId: user.tenantId,
          messageId: msg.id,
          to: lead.contact.phoneE164,
          kind: 'text',
          text: msg.body,
        });
      }
    });
    return visit;
  }

  private async updateVisit(user: AuthUser, visitId: string, data: Record<string, unknown>) {
    return this.prisma.withTenant(user.tenantId, async (tx) => {
      const visit = await tx.siteVisit.findUnique({ where: { id: visitId } });
      if (!visit) throw new NotFoundException('Visit not found');
      if (!canSeeAllLeads(user.role) && visit.agentId && visit.agentId !== user.id)
        throw new BadRequestException('Not your visit');
      return tx.siteVisit.update({ where: { id: visitId }, data });
    });
  }

  list(user: AuthUser) {
    return this.prisma.withTenant(user.tenantId, (tx) =>
      tx.siteVisit.findMany({
        where: canSeeAllLeads(user.role) ? {} : { agentId: user.id },
        orderBy: { slotAt: 'asc' },
        include: { lead: { include: { contact: true } } },
      }),
    );
  }
}
