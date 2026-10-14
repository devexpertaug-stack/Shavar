import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { ProviderConfig } from '@estateflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import type { UpsertProviderDto } from './dto';

export interface ProviderSummary {
  id: string;
  type: string;
  tenantKey: string;
  isActive: boolean;
  webhookUrl: string;
  // The config is never returned in full; only whether a secret/key is set.
  hasApiKey: boolean;
  hasWebhookSecret: boolean;
  baseUrl: string | null;
}

@Injectable()
export class ProviderSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  private apiBase(): string {
    return process.env.API_URL ?? 'http://localhost:4000';
  }

  private summarize(row: {
    id: string;
    type: string;
    tenantKey: string;
    isActive: boolean;
    encryptedConfig: string;
  }): ProviderSummary {
    const cfg = this.crypto.decrypt<ProviderConfig>(row.encryptedConfig);
    return {
      id: row.id,
      type: row.type,
      tenantKey: row.tenantKey,
      isActive: row.isActive,
      webhookUrl: `${this.apiBase()}/webhooks/whatsapp/${row.type.toLowerCase()}/${row.tenantKey}`,
      hasApiKey: Boolean(cfg.apiKey),
      hasWebhookSecret: Boolean(cfg.webhookSecret),
      baseUrl: cfg.baseUrl ?? null,
    };
  }

  async list(tenantId: string): Promise<ProviderSummary[]> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.providerCredential.findMany({ orderBy: { createdAt: 'asc' } }),
    );
    return rows.map((r) => this.summarize(r));
  }

  /** Create or update the tenant's credential for a provider type (encrypted). */
  async upsert(tenantId: string, dto: UpsertProviderDto): Promise<ProviderSummary> {
    const config: ProviderConfig = {
      type: dto.type,
      apiKey: dto.apiKey,
      baseUrl: dto.baseUrl,
      webhookSecret: dto.webhookSecret,
      phoneNumberId: dto.phoneNumberId,
    };
    const encryptedConfig = this.crypto.encrypt(config);

    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.providerCredential.findUnique({
        where: { tenantId_type: { tenantId, type: dto.type } },
      });
      if (existing) {
        return tx.providerCredential.update({
          where: { id: existing.id },
          data: { encryptedConfig, isActive: true },
        });
      }
      return tx.providerCredential.create({
        data: {
          tenantId,
          type: dto.type,
          tenantKey: randomBytes(16).toString('hex'),
          encryptedConfig,
        },
      });
    });
    return this.summarize(row);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const res = await this.prisma.withTenant(tenantId, (tx) =>
      tx.providerCredential.deleteMany({ where: { id } }),
    );
    if (res.count === 0) throw new NotFoundException('Provider credential not found');
  }
}
