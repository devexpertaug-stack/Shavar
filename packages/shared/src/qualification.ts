import { z } from 'zod';

/**
 * Strict qualification JSON the LLM must return after every inbound message
 * (PRD §4.3 / FR-8). The LLM only *extracts* these fields; scoring is a
 * deterministic code-side formula (FR-9) so it stays explainable and testable.
 */

export const Intent = z.enum(['buy', 'rent', 'invest', 'sell', 'browsing', 'spam']);
export type Intent = z.infer<typeof Intent>;

export const Timeline = z.enum(['0-3m', '3-6m', '6m+', 'unknown']);
export type Timeline = z.infer<typeof Timeline>;

export const Financing = z.enum(['loan', 'cash', 'unknown']);
export type Financing = z.infer<typeof Financing>;

export const Sentiment = z.enum(['pos', 'neu', 'neg']);
export type Sentiment = z.infer<typeof Sentiment>;

export const QualificationSchema = z.object({
  intent: Intent,
  property_type: z.string().nullable().default(null),
  bhk: z.number().int().nonnegative().nullable().default(null),
  budget_min: z.number().nonnegative().nullable().default(null),
  budget_max: z.number().nonnegative().nullable().default(null),
  locations: z.array(z.string()).default([]),
  timeline: Timeline.default('unknown'),
  financing: Financing.default('unknown'),
  site_visit_interest: z.boolean().default(false),
  sentiment: Sentiment.default('neu'),
  urgency_signals: z.array(z.string()).default([]),
  next_question: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0),
});

export type Qualification = z.infer<typeof QualificationSchema>;

/** A neutral, empty qualification used before any extraction has run. */
export const emptyQualification = (): Qualification =>
  QualificationSchema.parse({ intent: 'browsing' });
