import type { Job } from 'bullmq';
import type IORedis from 'ioredis';
import {
  matchRule,
  selectAssignee,
  type Candidate,
  type RoutingRule,
  type LeadRoutingFacts,
  type Qualification,
} from '@estateflow/shared';
import { withTenant } from '../prisma';
import { enqueue, QUEUES } from '../producer';
import { publishRealtime } from '../realtime-publisher';
import { logger } from '../logger';

interface RoutingJob {
  tenantId: string;
  leadId: string;
}

/**
 * Routing step (PRD §4.4). Evaluates active rules in priority order, selects an
 * assignee by strategy (honoring max_active_leads + language skills), assigns
 * the lead, notifies the assignee, and — for Hot leads — schedules an SLA check
 * so an uncontacted Hot lead escalates (FR-12).
 */
export async function processRouting(job: Job, redis: IORedis): Promise<{ ok: boolean }> {
  const { tenantId, leadId } = job.data as RoutingJob;

  const outcome = await withTenant(tenantId, async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: leadId }, include: { contact: true } });
    if (!lead || lead.assignedTo) return null; // only route unassigned leads

    const ruleRows = await tx.routingRule.findMany({ orderBy: { priority: 'asc' } });
    const rules: RoutingRule[] = ruleRows.map((r) => ({
      id: r.id,
      priority: r.priority,
      isActive: r.isActive,
      conditions: r.conditions as RoutingRule['conditions'],
      action: r.action as RoutingRule['action'],
    }));

    const q = lead.qualification as unknown as Qualification;
    const facts: LeadRoutingFacts = {
      source: lead.source,
      locations: q?.locations ?? [],
      language: lead.contact.language,
      tier: lead.tier,
    };
    const rule = matchRule(rules, facts);
    if (!rule) return null;

    // Build the candidate pool (active users with their current load).
    const users = await tx.user.findMany({ where: { isActive: true } });
    const candidates: Candidate[] = [];
    for (const u of users) {
      const activeLeadCount = await tx.lead.count({
        where: { assignedTo: u.id, stage: { notIn: ['Booked', 'Lost'] } },
      });
      candidates.push({
        id: u.id,
        teamId: u.teamId,
        languages: u.languages,
        activeLeadCount,
        maxActiveLeads: u.maxActiveLeads,
      });
    }

    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    const cursor = tenant?.routingCursor ?? 0;
    const assignee = selectAssignee(rule.action, candidates, cursor);
    if (!assignee) return null;

    await tx.lead.update({ where: { id: leadId }, data: { assignedTo: assignee } });
    await tx.tenant.update({ where: { id: tenantId }, data: { routingCursor: cursor + 1 } });
    await tx.activity.create({
      data: {
        tenantId,
        leadId,
        type: 'ASSIGNMENT',
        payload: { to: assignee, rule: rule.id, strategy: rule.action.strategy },
      },
    });
    await tx.notification.create({
      data: {
        tenantId,
        userId: assignee,
        type: lead.tier === 'HOT' ? 'HOT_LEAD' : 'LEAD_ASSIGNED',
        title: lead.tier === 'HOT' ? 'New HOT lead assigned' : 'New lead assigned',
        body: lead.contact.name ?? lead.contact.phoneE164,
        leadId,
      },
    });

    return { assignee, tier: lead.tier };
  });

  if (!outcome) return { ok: true };

  await publishRealtime(redis, {
    tenantId,
    userId: outcome.assignee,
    event: 'notification:new',
    payload: { leadId, type: outcome.tier === 'HOT' ? 'HOT_LEAD' : 'LEAD_ASSIGNED' },
  });

  // SLA: schedule an escalation check for Hot leads (delay-based).
  if (outcome.tier === 'HOT') {
    const slaMinutes = Number(process.env.HOT_SLA_MINUTES ?? 5);
    await enqueue(
      QUEUES.SLA,
      'check',
      { tenantId, leadId, assignedTo: outcome.assignee },
      { jobId: `sla:${tenantId}:${leadId}` },
      { delay: slaMinutes * 60_000 },
    );
  }
  logger.info({ tenantId, leadId, assignee: outcome.assignee }, 'routed lead');
  return { ok: true };
}
