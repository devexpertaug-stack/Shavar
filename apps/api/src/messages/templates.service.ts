import { Injectable } from '@nestjs/common';
import type { ProviderConfig } from '@estateflow/shared';
import { createWhatsAppProvider } from '@estateflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import type { UpsertTemplateDto } from './dto';

function countParams(body: string): number {
  const matches = body.match(/\{\{\s*\d+\s*\}\}/g);
  return matches ? new Set(matches).size : 0;
}

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  list(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.template.findMany({ orderBy: { name: 'asc' } }),
    );
  }

  upsert(tenantId: string, dto: UpsertTemplateDto) {
    const language = dto.language ?? 'en';
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.template.upsert({
        where: { tenantId_name_language: { tenantId, name: dto.name, language } },
        update: { body: dto.body, category: dto.category, paramCount: countParams(dto.body) },
        create: {
          tenantId,
          name: dto.name,
          language,
          body: dto.body,
          category: dto.category,
          paramCount: countParams(dto.body),
        },
      }),
    );
  }

  /**
   * Sync templates from the configured provider. Real BSP sync would call the
   * provider API; the Mock/dev path seeds a couple of defaults so the inbox
   * composer has approved templates to pick from.
   */
  async sync(tenantId: string): Promise<{ synced: number }> {
    const cred = await this.prisma.withTenant(tenantId, (tx) =>
      tx.providerCredential.findFirst({ where: { isActive: true } }),
    );
    // Build the provider (future: pull its template catalog).
    if (cred) {
      const cfg = this.crypto.decrypt<ProviderConfig>(cred.encryptedConfig);
      createWhatsAppProvider(cfg);
    }

    const defaults = [
      {
        name: 'welcome',
        body: 'Hi {{1}}, thanks for reaching out to us! How can we help you find your home today?',
      },
      {
        name: 'followup',
        body: 'Hi {{1}}, just following up on your enquiry. Would you like to schedule a site visit?',
      },
    ];
    let synced = 0;
    for (const t of defaults) {
      await this.upsert(tenantId, { name: t.name, body: t.body, language: 'en' });
      synced++;
    }
    return { synced };
  }
}
