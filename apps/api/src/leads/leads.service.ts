import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { normalizePhoneE164, type AuthUser } from '@estateflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PipelineService } from './pipeline.service';
import { validateStageTransition } from './stage-transition';
import { leadScopeWhere, canSeeAllLeads } from './scope';
import type { AddNoteDto, AssignDto, CreateLeadDto, LeadFiltersDto, UpdateStageDto } from './dto';

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
  ) {}

  /**
   * Create a lead. Dedup by normalized phone (FR-3): if a contact already
   * exists for (tenant, phoneE164) we reuse it and, if it already has a lead,
   * return that lead with a merged "enquiry" activity instead of a duplicate.
   */
  async create(user: AuthUser, dto: CreateLeadDto) {
    const phoneE164 = normalizePhoneE164(dto.phone);
    if (!phoneE164) throw new BadRequestException(`Invalid phone number: ${dto.phone}`);

    await this.pipeline.ensureStages(user.tenantId);

    return this.prisma.withTenant(user.tenantId, async (tx) => {
      const contact = await tx.contact.upsert({
        where: { tenantId_phoneE164: { tenantId: user.tenantId, phoneE164 } },
        update: {
          // Fill in name/language if newly provided and previously empty.
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.language ? { language: dto.language } : {}),
        },
        create: {
          tenantId: user.tenantId,
          phoneE164,
          name: dto.name ?? null,
          language: dto.language ?? null,
        },
      });

      // Dedup: an existing open lead for this contact is reused.
      const existing = await tx.lead.findFirst({
        where: { contactId: contact.id },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        await tx.activity.create({
          data: {
            tenantId: user.tenantId,
            leadId: existing.id,
            type: 'ENQUIRY',
            userId: user.id,
            payload: { note: 'Repeat enquiry merged into existing lead', source: dto.source },
          },
        });
        return this.hydrate(tx, existing.id);
      }

      const lead = await tx.lead.create({
        data: {
          tenantId: user.tenantId,
          contactId: contact.id,
          source: dto.source ?? 'MANUAL',
          stage: dto.stage ?? 'New',
          assignedTo: dto.assignedTo ?? null,
        },
      });
      await tx.activity.create({
        data: {
          tenantId: user.tenantId,
          leadId: lead.id,
          type: 'ENQUIRY',
          userId: user.id,
          payload: { note: 'Lead created', source: lead.source },
        },
      });
      if (lead.assignedTo) {
        await tx.activity.create({
          data: {
            tenantId: user.tenantId,
            leadId: lead.id,
            type: 'ASSIGNMENT',
            userId: user.id,
            payload: { to: lead.assignedTo },
          },
        });
      }
      return this.hydrate(tx, lead.id);
    });
  }

  async list(user: AuthUser, filters: LeadFiltersDto) {
    const where: Prisma.LeadWhereInput = {
      ...leadScopeWhere(user),
      ...(filters.stage ? { stage: filters.stage } : {}),
      ...(filters.tier ? { tier: filters.tier } : {}),
      ...(filters.source ? { source: filters.source } : {}),
      ...(filters.assignedTo ? { assignedTo: filters.assignedTo } : {}),
      ...(filters.search
        ? {
            contact: {
              OR: [
                { phoneE164: { contains: filters.search } },
                { name: { contains: filters.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    return this.prisma.withTenant(user.tenantId, async (tx) => {
      const [total, items] = await Promise.all([
        tx.lead.count({ where }),
        tx.lead.findMany({
          where,
          include: { contact: true },
          orderBy: { updatedAt: 'desc' },
          skip: (filters.page - 1) * filters.pageSize,
          take: filters.pageSize,
        }),
      ]);
      return {
        items,
        total,
        page: filters.page,
        pageSize: filters.pageSize,
        totalPages: Math.ceil(total / filters.pageSize),
      };
    });
  }

  /** Kanban view: leads grouped by stage (scoped to the caller). */
  async board(user: AuthUser) {
    await this.pipeline.ensureStages(user.tenantId);
    return this.prisma.withTenant(user.tenantId, async (tx) => {
      const [stages, leads] = await Promise.all([
        tx.pipelineStage.findMany({ orderBy: { order: 'asc' } }),
        tx.lead.findMany({
          where: leadScopeWhere(user),
          include: { contact: true },
          orderBy: { updatedAt: 'desc' },
        }),
      ]);
      return {
        stages,
        columns: stages.map((s) => ({
          stage: s.name,
          leads: leads.filter((l) => l.stage === s.name),
        })),
      };
    });
  }

  async get(user: AuthUser, id: string) {
    const lead = await this.prisma.withTenant(user.tenantId, (tx) => this.hydrate(tx, id));
    if (!lead) throw new NotFoundException('Lead not found');
    this.assertCanAccess(user, lead.assignedTo);
    return lead;
  }

  async changeStage(user: AuthUser, id: string, dto: UpdateStageDto) {
    return this.prisma.withTenant(user.tenantId, async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id } });
      if (!lead) throw new NotFoundException('Lead not found');
      this.assertCanAccess(user, lead.assignedTo);

      const validStages = await this.pipeline.stageNames(tx);
      const check = validateStageTransition({
        from: lead.stage,
        to: dto.stage,
        lostReason: dto.lostReason,
        validStages,
      });
      if (!check.ok) throw new BadRequestException(check.error);

      await tx.lead.update({
        where: { id },
        data: {
          stage: dto.stage,
          lostReason: dto.stage === 'Lost' ? dto.lostReason : null,
        },
      });
      await tx.activity.create({
        data: {
          tenantId: user.tenantId,
          leadId: id,
          type: 'STAGE_CHANGE',
          userId: user.id,
          payload: { from: lead.stage, to: dto.stage, lostReason: dto.lostReason ?? null },
        },
      });
      return this.hydrate(tx, id);
    });
  }

  async assign(user: AuthUser, id: string, dto: AssignDto) {
    return this.prisma.withTenant(user.tenantId, async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id } });
      if (!lead) throw new NotFoundException('Lead not found');
      this.assertCanAccess(user, lead.assignedTo);

      if (dto.assignedTo) {
        const assignee = await tx.user.findFirst({
          where: { id: dto.assignedTo, isActive: true },
        });
        if (!assignee) throw new BadRequestException('Assignee not found in this tenant');
      }

      await tx.lead.update({ where: { id }, data: { assignedTo: dto.assignedTo } });
      await tx.activity.create({
        data: {
          tenantId: user.tenantId,
          leadId: id,
          type: 'ASSIGNMENT',
          userId: user.id,
          payload: { from: lead.assignedTo, to: dto.assignedTo },
        },
      });
      return this.hydrate(tx, id);
    });
  }

  /** Human takes over the conversation — the AI goes silent (FR-7). */
  async takeover(user: AuthUser, id: string) {
    return this.setAiActive(user, id, false, 'takeover');
  }

  /** Hand control back to the AI. */
  async release(user: AuthUser, id: string) {
    return this.setAiActive(user, id, true, 'release');
  }

  private async setAiActive(user: AuthUser, id: string, aiActive: boolean, kind: string) {
    return this.prisma.withTenant(user.tenantId, async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id } });
      if (!lead) throw new NotFoundException('Lead not found');
      this.assertCanAccess(user, lead.assignedTo);
      await tx.lead.update({ where: { id }, data: { aiActive } });
      await tx.activity.create({
        data: { tenantId: user.tenantId, leadId: id, type: 'NOTE', userId: user.id, payload: { kind, aiActive } },
      });
      return this.hydrate(tx, id);
    });
  }

  async addNote(user: AuthUser, id: string, dto: AddNoteDto) {
    return this.prisma.withTenant(user.tenantId, async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id } });
      if (!lead) throw new NotFoundException('Lead not found');
      this.assertCanAccess(user, lead.assignedTo);

      const activity = await tx.activity.create({
        data: {
          tenantId: user.tenantId,
          leadId: id,
          type: 'NOTE',
          userId: user.id,
          payload: { body: dto.body },
        },
      });
      return activity;
    });
  }

  // --- helpers ---------------------------------------------------------------

  private assertCanAccess(user: AuthUser, assignedTo: string | null): void {
    if (canSeeAllLeads(user.role)) return;
    if (assignedTo !== user.id) {
      throw new ForbiddenException('You can only access leads assigned to you');
    }
  }

  private hydrate(tx: Prisma.TransactionClient, id: string) {
    return tx.lead.findUnique({
      where: { id },
      include: {
        contact: true,
        activities: { orderBy: { createdAt: 'desc' }, take: 100 },
        scoreEvents: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
  }
}
