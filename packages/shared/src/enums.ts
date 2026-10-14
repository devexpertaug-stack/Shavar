import { z } from 'zod';

/** Lead score tiers (PRD §4.3 / FR-10). Thresholds: Hot >= 70, Warm 40-69, Cold < 40. */
export const Tier = z.enum(['HOT', 'WARM', 'COLD']);
export type Tier = z.infer<typeof Tier>;

export const TIER_THRESHOLDS = { HOT: 70, WARM: 40 } as const;

export function tierForScore(score: number): Tier {
  if (score >= TIER_THRESHOLDS.HOT) return 'HOT';
  if (score >= TIER_THRESHOLDS.WARM) return 'WARM';
  return 'COLD';
}

/** Default pipeline stages (PRD §4.8 / FR-20). Tenants may customize these. */
export const DEFAULT_STAGES = [
  'New',
  'Contacted',
  'Qualified',
  'Visit Scheduled',
  'Visited',
  'Negotiation',
  'Booked',
  'Lost',
] as const;

export const LeadSource = z.enum([
  'WHATSAPP',
  'META_LEAD_ADS',
  'NINETY_NINE_ACRES',
  'MAGICBRICKS',
  'HOUSING',
  'WEBSITE',
  'REFERRAL',
  'MANUAL',
]);
export type LeadSource = z.infer<typeof LeadSource>;

export const MessageDirection = z.enum(['INBOUND', 'OUTBOUND']);
export type MessageDirection = z.infer<typeof MessageDirection>;

export const MessageSentBy = z.enum(['ai', 'user', 'system']);
export type MessageSentBy = z.infer<typeof MessageSentBy>;

export const WhatsAppProviderType = z.enum(['AISENSY', 'WATI', 'META_CLOUD', 'MOCK']);
export type WhatsAppProviderType = z.infer<typeof WhatsAppProviderType>;

/** Activity timeline event types (PRD §7 activities table). */
export const ActivityType = z.enum([
  'NOTE',
  'STAGE_CHANGE',
  'ASSIGNMENT',
  'CALL',
  'VISIT',
  'ENQUIRY',
  'MESSAGE',
  'SCORE_CHANGE',
]);
export type ActivityType = z.infer<typeof ActivityType>;

/**
 * The terminal "lost" stage requires a reason (FR-20). This is the canonical
 * stage name used for that rule; tenants may rename stages but the seeded
 * default set uses this label.
 */
export const LOST_STAGE = 'Lost';
export const BOOKED_STAGE = 'Booked';
