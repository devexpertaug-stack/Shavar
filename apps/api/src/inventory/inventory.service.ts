import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  createLlmProvider,
  unitEmbeddingText,
  leadQueryText,
  passesHardFilters,
  type LlmProvider,
  type Qualification,
} from '@estateflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService, QUEUES } from '../queue/queue.service';
import type { CreateProjectDto, CreateUnitDto } from './dto';

@Injectable()
export class InventoryService {
  private llm: LlmProvider = createLlmProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  // --- projects ---
  listProjects(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.project.findMany({ orderBy: { name: 'asc' } }));
  }
  createProject(tenantId: string, dto: CreateProjectDto) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.project.create({
        data: {
          tenantId,
          name: dto.name,
          location: dto.location,
          description: dto.description,
          amenities: dto.amenities ?? [],
          mapPin: dto.mapPin,
          brochureUrl: dto.brochureUrl,
        },
      }),
    );
  }

  // --- units ---
  listUnits(tenantId: string, projectId?: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.unit.findMany({
        where: projectId ? { projectId } : {},
        include: { project: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async createUnit(tenantId: string, dto: CreateUnitDto) {
    const unit = await this.prisma.withTenant(tenantId, async (tx) => {
      const project = await tx.project.findFirst({ where: { id: dto.projectId } });
      if (!project) throw new BadRequestException('Project not found');
      const created = await tx.unit.create({
        data: {
          tenantId,
          projectId: dto.projectId,
          name: dto.name,
          bhk: dto.bhk,
          carpetArea: dto.carpetArea,
          priceMin: dto.priceMin,
          priceMax: dto.priceMax,
          facing: dto.facing,
          floor: dto.floor,
          isAvailable: dto.isAvailable ?? true,
        },
      });
      return { created, project };
    });

    // Embed + persist the vector (raw SQL — pgvector column).
    await this.embedUnit(tenantId, unit.created.id, {
      projectName: unit.project.name,
      location: unit.project.location,
      bhk: dto.bhk,
      amenities: unit.project.amenities,
      priceMin: dto.priceMin,
      priceMax: dto.priceMax,
    });

    return unit.created;
  }

  private async embedUnit(
    tenantId: string,
    unitId: string,
    u: Parameters<typeof unitEmbeddingText>[0],
  ): Promise<void> {
    const vec = await this.llm.embed(unitEmbeddingText(u));
    const literal = `[${vec.join(',')}]`;
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.$executeRawUnsafe(`UPDATE units SET embedding = $1::vector WHERE id = $2::uuid`, literal, unitId),
    );
  }

  /** CSV import of units: header row then rows (projectId,name,bhk,priceMin,priceMax[,carpetArea]). */
  async importCsv(tenantId: string, csv: string): Promise<{ imported: number }> {
    const lines = csv.trim().split(/\r?\n/);
    if (lines.length < 2) throw new BadRequestException('CSV has no data rows');
    const header = lines[0].split(',').map((h) => h.trim());
    const idx = (k: string) => header.indexOf(k);
    let imported = 0;
    for (const line of lines.slice(1)) {
      const cols = line.split(',');
      const dto: CreateUnitDto = {
        projectId: cols[idx('projectId')]?.trim(),
        name: cols[idx('name')]?.trim(),
        bhk: Number(cols[idx('bhk')]),
        priceMin: Number(cols[idx('priceMin')]),
        priceMax: Number(cols[idx('priceMax')]),
        carpetArea: idx('carpetArea') >= 0 ? Number(cols[idx('carpetArea')]) : undefined,
      };
      if (!dto.projectId || !dto.name || Number.isNaN(dto.bhk)) continue;
      await this.createUnit(tenantId, dto);
      imported++;
    }
    return { imported };
  }

  /**
   * Match the top N units for a lead: hard filters (budget/BHK/location) +
   * pgvector cosine ranking on the embedding (PRD §4.6 / FR-17).
   */
  async match(tenantId: string, leadId: string, limit = 3) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id: leadId } });
      if (!lead) throw new NotFoundException('Lead not found');
      const q = lead.qualification as unknown as Qualification;

      const queryVec = await this.llm.embed(leadQueryText(q) || `${q.bhk ?? ''}BHK`);
      const literal = `[${queryVec.join(',')}]`;

      // Vector-rank available units, then apply hard filters in JS for clarity.
      const ranked = await tx.$queryRawUnsafe<
        {
          id: string;
          name: string;
          bhk: number;
          priceMin: number;
          priceMax: number;
          isAvailable: boolean;
          projectName: string;
          location: string;
          distance: number | null;
        }[]
      >(
        `SELECT u.id, u.name, u.bhk, u."priceMin", u."priceMax", u."isAvailable",
                p.name AS "projectName", p.location AS "location",
                CASE WHEN u.embedding IS NULL THEN NULL ELSE (u.embedding <=> $1::vector) END AS distance
         FROM units u JOIN projects p ON p.id = u."projectId"
         WHERE u."isAvailable" = true
         ORDER BY distance ASC NULLS LAST
         LIMIT 50`,
        literal,
      );

      const filtered = ranked.filter((u) =>
        passesHardFilters(
          { bhk: u.bhk, priceMin: u.priceMin, priceMax: u.priceMax, location: u.location, isAvailable: u.isAvailable },
          q,
        ),
      );
      return filtered.slice(0, limit);
    });
  }

  /** Queue a WhatsApp send of a unit's brochure or location pin to the lead. */
  async sendUnit(tenantId: string, leadId: string, unitId: string, what: 'brochure' | 'location') {
    const brochure = what === 'brochure';
    const job = await this.prisma.withTenant(tenantId, async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id: leadId }, include: { contact: true } });
      const unit = await tx.unit.findUnique({ where: { id: unitId }, include: { project: true } });
      if (!lead || !unit) throw new NotFoundException('Lead or unit not found');

      const useMedia = brochure && Boolean(unit.project.brochureUrl);
      const pin = unit.project.mapPin ?? '';
      const text = `${unit.project.name} — ${unit.project.location}${pin ? ` (map: https://maps.google.com/?q=${pin})` : ''}`;

      // Persist a queued OUTBOUND message so the worker can update its status.
      const message = await tx.message.create({
        data: {
          tenantId,
          leadId,
          direction: 'OUTBOUND',
          type: useMedia ? 'image' : 'text',
          body: useMedia ? null : text,
          mediaUrl: useMedia ? unit.project.brochureUrl : null,
          status: 'queued',
          sentBy: 'user',
        },
      });
      return {
        messageId: message.id,
        to: lead.contact.phoneE164,
        kind: useMedia ? 'media' : 'text',
        text: useMedia ? undefined : text,
        mediaUrl: useMedia ? unit.project.brochureUrl : undefined,
      };
    });

    await this.queue.enqueue(QUEUES.OUTBOUND, 'send', { tenantId, ...job });
    return { ok: true };
  }
}
