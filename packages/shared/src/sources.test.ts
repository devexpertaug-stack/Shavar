import { describe, it, expect } from 'vitest';
import {
  parseMetaLeadAds,
  parseWebsiteForm,
  parsePortalLead,
  extractWhatsAppAttribution,
  parseLeadSource,
} from './sources';

describe('parseMetaLeadAds', () => {
  it('extracts phone/name/attribution from a leadgen change', () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                ad_id: 'ad123',
                form_id: 'f1',
                leadgen_id: 'lg1',
                field_data: [
                  { name: 'full_name', values: ['Rohit Sharma'] },
                  { name: 'phone_number', values: ['+919812345678'] },
                ],
              },
            },
          ],
        },
      ],
    };
    const leads = parseMetaLeadAds(body);
    expect(leads).toHaveLength(1);
    expect(leads[0].phone).toBe('+919812345678');
    expect(leads[0].name).toBe('Rohit Sharma');
    expect(leads[0].source).toBe('META_LEAD_ADS');
    expect(leads[0].attribution?.adId).toBe('ad123');
  });
});

describe('parseWebsiteForm', () => {
  it('maps name/phone + utm attribution', () => {
    const n = parseWebsiteForm({ name: 'Anjali', phone: '9812345678', utm_source: 'google', utm_campaign: 'q1' });
    expect(n.phone).toBe('9812345678');
    expect(n.source).toBe('WEBSITE');
    expect(n.campaignId).toBe('q1');
    expect(n.attribution?.utm_source).toBe('google');
  });
});

describe('parsePortalLead', () => {
  it('maps 99acres fields', () => {
    const n = parsePortalLead('NINETY_NINE_ACRES', { customerName: 'Imran', contactNumber: '9898989898' });
    expect(n.name).toBe('Imran');
    expect(n.phone).toBe('9898989898');
    expect(n.source).toBe('NINETY_NINE_ACRES');
  });
  it('maps MagicBricks fields', () => {
    const n = parsePortalLead('MAGICBRICKS', { leadName: 'Sneha', mobile: '9777777777' });
    expect(n.name).toBe('Sneha');
    expect(n.phone).toBe('9777777777');
  });
  it('maps Housing fields', () => {
    const n = parsePortalLead('HOUSING', { userName: 'Vikram', phone: '9666666666' });
    expect(n.name).toBe('Vikram');
    expect(n.phone).toBe('9666666666');
  });
});

describe('extractWhatsAppAttribution', () => {
  it('normalizes click-to-WhatsApp referral data', () => {
    const a = extractWhatsAppAttribution({ source_id: 'ad9', source_type: 'ad', ctwa_clid: 'clid1' });
    expect(a?.sourceId).toBe('ad9');
    expect(a?.sourceType).toBe('ad');
    expect(a?.ctwaClid).toBe('clid1');
  });
  it('returns null when absent', () => {
    expect(extractWhatsAppAttribution(null)).toBeNull();
  });
});

describe('parseLeadSource dispatch', () => {
  it('routes by source key', () => {
    expect(parseLeadSource('website', { phone: '1' })[0].source).toBe('WEBSITE');
    expect(parseLeadSource('99acres', { contactNumber: '1' })[0].source).toBe('NINETY_NINE_ACRES');
    expect(parseLeadSource('unknown', {})).toHaveLength(0);
  });
});
