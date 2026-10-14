import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  rankQueue,
  isValidOutcome,
  createTelephonyProvider,
  type AuthUser,
  type Qualification,
  type TelephonyProvider,
} from '@estateflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { canSeeAllLeads } from '../leads/scope';

@Injectable()
export class CallsService {
  private telephony: TelephonyProvider = createTelephonyProvider();

  constructor(private readonly prisma: PrismaService) {}

  /** AI 3-line brief for a lead card (FR-13), derived from qualification. */
  private brief(q: Qualification, contactName: string | null): string {
    const bits: string[] = [];
    if (q.bhk || q.property_type) bits.push(`Wants ${q.bhk ? `${q.bhk}BHK ` : ''}${q.property_type ?? ''}`.trim());
    if (q.locations?.length) bits.push(`in ${q.locations.join('/')}`);
    if (q.budget_max) bits.push(`₹${Math.round((q.budget_min ?? 0) / 100000)}–${Math.round(q.budget_max / 100000)}L`);
    if (q.timeline && q.timeline !== 'unknown') bits.push(`timeline ${q.timeline}`);
    if (q.financing && q.financing !== 'unknown') bits.push(q.financing);
    const line1 = (contactName ? `${contactName}: ` : '') + (bits.join(', ') || 'New enquiry');
    const line2 = q.urgency_signals?.length ? `Signals: ${q.urgency_signals.join('; ')}` : 'No urgency signals yet.';
    const line3 = q.site_visit_interest ? 'Interested in a site visit — offer a slot.' : 'Qualify budget/timeline, then offer a visit.';
    return [line1, line2, line3].join('\n');
  }

  /** Next Best Call queue for the caller, ranked (FR-13). */
  async nextBestCalls(user: AuthUser, limit = 25) {
    return this.prisma.withTenant(user.tenantId, async (tx) => {
      const leads = await tx.lead.findMany({
        where: {
          stage: { notIn: ['Booked', 'Lost'] },
          ...(canSeeAllLeads(user.role) ? {} : { assignedTo: user.id }),
        },
        include: {
          contact: true,
          calls: { orderBy: { createdAt: 'desc' }, take: 1 },
          messages: { where: { direction: 'OUTBOUND' }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
        take: 200,
      });

      const rankable = leads.map((l) => {
        const q = l.qualification as unknown as Qualification;
        const lastCall = l.calls[0]?.createdAt ?? null;
        const lastOut = l.messages[0]?.createdAt ?? null;
        const lastTouchAt =
          lastCall && lastOut ? (lastCall > lastOut ? lastCall : lastOut) : (lastCall ?? lastOut);
        return {
          leadId: l.id,
          score: l.score,
          tier: l.tier,
          urgencySignals: q?.urgency_signals?.length ?? 0,
          lastTouchAt,
          nextFollowupAt: l.nextFollowupAt,
          contact: { name: l.contact.name, phoneE164: l.contact.phoneE164 },
          brief: this.brief(q ?? ({} as Qualification), l.contact.name),
        };
      });

      return rankQueue(rankable).slice(0, limit);
    });
  }

  /** Click-to-call: creates a call log and dials via the telephony provider. */
  async clickToCall(user: AuthUser, leadId: string, agentNumber: string) {
    const result = await this.prisma.withTenant(user.tenantId, async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id: leadId }, include: { contact: true } });
      if (!lead) throw new NotFoundException('Lead not found');
      if (!canSeeAllLeads(user.role) && lead.assignedTo !== user.id)
        throw new BadRequestException('Lead not assigned to you');
      return { phone: lead.contact.phoneE164 };
    });

    const dial = await this.telephony.clickToCall({
      agentNumber,
      customerNumber: result.phone,
    });

    return this.prisma.withTenant(user.tenantId, (tx) =>
      tx.call.create({
        data: { tenantId: user.tenantId, leadId, userId: user.id, providerCallId: dial.providerCallId },
      }),
    );
  }

  /** Mandatory outcome after a call (FR-15), optionally setting next follow-up. */
  async logOutcome(user: AuthUser, callId: string, outcome: string, nextFollowupAt?: string) {
    if (!isValidOutcome(outcome)) throw new BadRequestException('Invalid outcome');
    return this.prisma.withTenant(user.tenantId, async (tx) => {
      const call = await tx.call.findUnique({ where: { id: callId } });
      if (!call) throw new NotFoundException('Call not found');
      const updated = await tx.call.update({ where: { id: callId }, data: { outcome } });
      await tx.activity.create({
        data: { tenantId: user.tenantId, leadId: call.leadId, type: 'CALL', userId: user.id, payload: { outcome } },
      });
      if (nextFollowupAt) {
        await tx.lead.update({
          where: { id: call.leadId },
          data: { nextFollowupAt: new Date(nextFollowupAt) },
        });
      }
      // visit_booked advances the stage.
      if (outcome === 'visit_booked') {
        await tx.lead.update({ where: { id: call.leadId }, data: { stage: 'Visit Scheduled' } });
      }
      return updated;
    });
  }

  /** Exotel/mock call webhook: attach duration + recording to the call log. */
  async handleWebhook(tenantId: string, body: Record<string, unknown>) {
    const parsed = this.telephony.parseWebhook(body);
    if (!parsed.providerCallId) return { ok: false };
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.call.updateMany({
        where: { providerCallId: parsed.providerCallId },
        data: {
          durationSec: parsed.durationSec ?? undefined,
          recordingUrl: parsed.recordingUrl ?? undefined,
        },
      }),
    );
    return { ok: true };
  }
}
