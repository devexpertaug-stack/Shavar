import { z } from 'zod';
import { LeadSource, Tier } from './enums';

/** A pipeline stage as returned to clients. */
export const PipelineStageSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  order: z.number().int(),
  isTerminal: z.boolean(),
});
export type PipelineStageDto = z.infer<typeof PipelineStageSchema>;

/** Contact (person) summary embedded in a lead. */
export const ContactSchema = z.object({
  id: z.string().uuid(),
  phoneE164: z.string(),
  name: z.string().nullable(),
  language: z.string().nullable(),
  optedIn: z.boolean(),
  optedOutAt: z.string().nullable(),
});
export type ContactDto = z.infer<typeof ContactSchema>;

export const LeadSummarySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  contact: ContactSchema,
  source: LeadSource,
  stage: z.string(),
  tier: Tier,
  score: z.number().int(),
  assignedTo: z.string().uuid().nullable(),
  nextFollowupAt: z.string().nullable(),
  lastInboundAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LeadSummaryDto = z.infer<typeof LeadSummarySchema>;

// ---- Request DTOs (validated server-side; shared for the web client too) ----

export const CreateLeadSchema = z.object({
  phone: z.string().min(3),
  name: z.string().optional(),
  language: z.string().optional(),
  source: LeadSource.default('MANUAL'),
  stage: z.string().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
});
export type CreateLeadRequest = z.infer<typeof CreateLeadSchema>;

export const UpdateStageSchema = z
  .object({
    stage: z.string().min(1),
    // Required when moving to a terminal "Lost" stage (FR-20).
    lostReason: z.string().min(1).optional(),
  })
  .passthrough();
export type UpdateStageRequest = z.infer<typeof UpdateStageSchema>;

export const AssignSchema = z.object({
  assignedTo: z.string().uuid().nullable(),
});
export type AssignRequest = z.infer<typeof AssignSchema>;

export const AddNoteSchema = z.object({
  body: z.string().min(1),
});
export type AddNoteRequest = z.infer<typeof AddNoteSchema>;

export const LeadFiltersSchema = z.object({
  stage: z.string().optional(),
  tier: Tier.optional(),
  source: LeadSource.optional(),
  assignedTo: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type LeadFilters = z.infer<typeof LeadFiltersSchema>;
