import type { LeadSource } from './enums';

/**
 * Lead-source parsers (PRD §4.1 / FR-2, Task 14). Each channel posts a
 * different payload; a parser normalizes it to NormalizedLead so the intake
 * pipeline is source-agnostic. Pure + tested.
 */
export interface NormalizedLead {
  phone: string | null;
  name: string | null;
  source: LeadSource;
  campaignId?: string | null;
  // Click-to-WhatsApp / ad attribution when present.
  attribution?: Record<string, unknown> | null;
  raw?: unknown;
}

/** Meta Lead Ads webhook (leadgen change). */
export function parseMetaLeadAds(body: unknown): NormalizedLead[] {
  const payload = (body ?? {}) as Record<string, unknown>;
  const out: NormalizedLead[] = [];
  const entries = Array.isArray(payload.entry) ? (payload.entry as Record<string, unknown>[]) : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? (entry.changes as Record<string, unknown>[]) : [];
    for (const change of changes) {
      const value = (change.value ?? {}) as Record<string, unknown>;
      const fields = Array.isArray(value.field_data)
        ? (value.field_data as { name: string; values: string[] }[])
        : [];
      const get = (n: string) =>
        fields.find((f) => f.name === n || f.name === `${n}_number`)?.values?.[0] ?? null;
      out.push({
        phone: get('phone') ?? get('phone_number'),
        name: get('full_name') ?? get('name'),
        source: 'META_LEAD_ADS',
        campaignId: (value.campaign_id as string) ?? (value.ad_id as string) ?? null,
        attribution: { adId: value.ad_id, formId: value.form_id, leadgenId: value.leadgen_id },
        raw: value,
      });
    }
  }
  return out;
}

/** Website embed form POST. */
export function parseWebsiteForm(body: unknown): NormalizedLead {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    phone: (b.phone as string) ?? (b.mobile as string) ?? null,
    name: (b.name as string) ?? (b.fullName as string) ?? null,
    source: 'WEBSITE',
    campaignId: (b.utm_campaign as string) ?? null,
    attribution: { utm_source: b.utm_source, utm_medium: b.utm_medium, page: b.page },
    raw: b,
  };
}

/** Portal parsers (99acres / MagicBricks / Housing) — API or parsed-email JSON. */
export type PortalSource = 'NINETY_NINE_ACRES' | 'MAGICBRICKS' | 'HOUSING';

const PORTAL_FIELD_MAP: Record<PortalSource, { phone: string[]; name: string[] }> = {
  NINETY_NINE_ACRES: { phone: ['contactNumber', 'phone', 'mobile'], name: ['customerName', 'name'] },
  MAGICBRICKS: { phone: ['mobile', 'phone', 'contact'], name: ['name', 'leadName'] },
  HOUSING: { phone: ['phone', 'mobile'], name: ['name', 'userName'] },
};

export function parsePortalLead(source: PortalSource, body: unknown): NormalizedLead {
  const b = (body ?? {}) as Record<string, unknown>;
  const map = PORTAL_FIELD_MAP[source];
  const pick = (keys: string[]) => {
    for (const k of keys) if (b[k]) return String(b[k]);
    return null;
  };
  return {
    phone: pick(map.phone),
    name: pick(map.name),
    source,
    campaignId: (b.projectId as string) ?? (b.project as string) ?? null,
    raw: b,
  };
}

/** Extract click-to-WhatsApp ad attribution from a WhatsApp inbound referral. */
export function extractWhatsAppAttribution(
  referral: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!referral) return null;
  return {
    sourceId: referral.source_id ?? referral.sourceId ?? null,
    sourceUrl: referral.source_url ?? referral.sourceUrl ?? null,
    sourceType: referral.source_type ?? referral.sourceType ?? null,
    headline: referral.headline ?? null,
    ctwaClid: referral.ctwa_clid ?? null,
  };
}

export function parseLeadSource(source: string, body: unknown): NormalizedLead[] {
  switch (source) {
    case 'meta':
    case 'META_LEAD_ADS':
      return parseMetaLeadAds(body);
    case 'website':
    case 'WEBSITE':
      return [parseWebsiteForm(body)];
    case '99acres':
    case 'NINETY_NINE_ACRES':
      return [parsePortalLead('NINETY_NINE_ACRES', body)];
    case 'magicbricks':
    case 'MAGICBRICKS':
      return [parsePortalLead('MAGICBRICKS', body)];
    case 'housing':
    case 'HOUSING':
      return [parsePortalLead('HOUSING', body)];
    default:
      return [];
  }
}
