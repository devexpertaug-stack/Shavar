import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { MockWhatsAppProvider } from './mock';
import { WatiProvider } from './wati';
import { AiSensyProvider } from './aisensy';
import { createWhatsAppProvider } from './index';

describe('MockWhatsAppProvider', () => {
  const p = new MockWhatsAppProvider();

  it('parses the single-message shortcut shape', () => {
    const parsed = p.parseWebhook({ from: '919812345678', text: 'hi', providerMessageId: 'm1' });
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].text).toBe('hi');
    expect(parsed.messages[0].providerMessageId).toBe('m1');
  });

  it('verifies with a matching secret header and rejects a wrong one', () => {
    expect(p.verifyWebhook({ headers: { 'x-mock-secret': 's' }, secret: 's' })).toBe(true);
    expect(p.verifyWebhook({ headers: { 'x-mock-secret': 'nope' }, secret: 's' })).toBe(false);
    expect(p.verifyWebhook({ headers: {}, secret: undefined })).toBe(true);
  });
});

describe('WatiProvider', () => {
  const p = new WatiProvider({ webhookSecret: 'wati-secret' });

  it('parses an inbound text message (waId + text + id)', () => {
    const parsed = p.parseWebhook({
      eventType: 'message',
      id: 'wamid.ABC',
      waId: '919812345678',
      senderName: 'Rohit',
      type: 'text',
      text: '2bhk chahiye wakad me',
      timestamp: '1739500000',
    });
    expect(parsed.messages).toHaveLength(1);
    const m = parsed.messages[0];
    expect(m.providerMessageId).toBe('wamid.ABC');
    expect(m.from).toBe('919812345678');
    expect(m.text).toBe('2bhk chahiye wakad me');
    expect(m.contactName).toBe('Rohit');
  });

  it('parses a status (delivered) event', () => {
    const parsed = p.parseWebhook({
      eventType: 'messageStatus',
      id: 'wamid.ABC',
      statusString: 'DELIVERED',
      timestamp: '1739500001',
    });
    expect(parsed.messages).toHaveLength(0);
    expect(parsed.statuses[0]).toMatchObject({ providerMessageId: 'wamid.ABC', status: 'delivered' });
  });

  it('verifies via the token query param and rejects a mismatch', () => {
    expect(
      p.verifyWebhook({ headers: {}, query: { token: 'wati-secret' } }),
    ).toBe(true);
    expect(p.verifyWebhook({ headers: {}, query: { token: 'bad' } })).toBe(false);
  });
});

describe('AiSensyProvider (Meta Cloud shape)', () => {
  const p = new AiSensyProvider({ webhookSecret: 'as-secret' });

  const inboundBody = {
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: '919812345678', profile: { name: 'Anjali' } }],
              messages: [
                {
                  id: 'wamid.XYZ',
                  from: '919812345678',
                  type: 'text',
                  text: { body: 'Price kya hai?' },
                  timestamp: '1739500100',
                },
              ],
            },
          },
        ],
      },
    ],
  };

  it('parses an inbound text message from the entry/changes/value shape', () => {
    const parsed = p.parseWebhook(inboundBody);
    expect(parsed.messages).toHaveLength(1);
    const m = parsed.messages[0];
    expect(m.providerMessageId).toBe('wamid.XYZ');
    expect(m.from).toBe('919812345678');
    expect(m.text).toBe('Price kya hai?');
    expect(m.contactName).toBe('Anjali');
  });

  it('parses an image message with caption + media', () => {
    const parsed = p.parseWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.IMG',
                    from: '919800000000',
                    type: 'image',
                    image: { link: 'https://cdn/x.jpg', mime_type: 'image/jpeg', caption: 'floor plan' },
                    timestamp: '1739500200',
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const m = parsed.messages[0];
    expect(m.type).toBe('image');
    expect(m.mediaUrl).toBe('https://cdn/x.jpg');
    expect(m.text).toBe('floor plan');
  });

  it('verifies a valid HMAC-SHA256 signature and rejects a tampered body', () => {
    const raw = JSON.stringify(inboundBody);
    const sig = 'sha256=' + createHmac('sha256', 'as-secret').update(raw).digest('hex');
    expect(p.verifyWebhook({ rawBody: raw, headers: { 'x-hub-signature-256': sig }, query: {} })).toBe(
      true,
    );
    expect(
      p.verifyWebhook({ rawBody: raw + 'tamper', headers: { 'x-hub-signature-256': sig }, query: {} }),
    ).toBe(false);
  });
});

describe('createWhatsAppProvider factory', () => {
  it('builds each provider type', () => {
    expect(createWhatsAppProvider({ type: 'WATI' }).type).toBe('WATI');
    expect(createWhatsAppProvider({ type: 'AISENSY' }).type).toBe('AISENSY');
    expect(createWhatsAppProvider({ type: 'META_CLOUD' }).type).toBe('AISENSY');
    expect(createWhatsAppProvider({ type: 'MOCK' }).type).toBe('MOCK');
  });
});
