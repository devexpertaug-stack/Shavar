import { describe, it, expect } from 'vitest';
import { decideAgentAction, buildAgentSystemPrompt, type HandoverContext } from './agent';
import { emptyQualification } from './qualification';

const now = new Date('2026-02-14T12:00:00');
function ctx(over: Partial<HandoverContext> = {}): HandoverContext {
  return {
    aiActive: true,
    lastInboundText: 'hi, 2bhk chahiye',
    qualification: { ...emptyQualification(), intent: 'buy', confidence: 0.8 },
    aiMessagesToday: 0,
    lastInboundAt: now,
    guardrails: {},
    now,
    ...over,
  };
}

describe('decideAgentAction', () => {
  it('replies for a normal in-window message', () => {
    const d = decideAgentAction(ctx());
    expect(d.shouldReply).toBe(true);
    expect(d.handover).toBe(false);
  });

  it('stays silent when AI is disabled (human took over)', () => {
    const d = decideAgentAction(ctx({ aiActive: false }));
    expect(d.shouldReply).toBe(false);
    expect(d.reason).toBe('ai_disabled');
  });

  it('does not reply outside the 24h window', () => {
    const d = decideAgentAction(ctx({ lastInboundAt: new Date('2026-02-12T12:00:00') }));
    expect(d.shouldReply).toBe(false);
    expect(d.reason).toBe('outside_window');
  });

  it('respects the per-lead daily cap', () => {
    const d = decideAgentAction(ctx({ aiMessagesToday: 10, guardrails: { maxAiMessagesPerLeadPerDay: 10 } }));
    expect(d.shouldReply).toBe(false);
    expect(d.reason).toBe('daily_cap');
  });

  it('respects working hours', () => {
    const night = new Date('2026-02-14T23:00:00');
    const d = decideAgentAction(ctx({ now: night, lastInboundAt: night, guardrails: { workingHours: { start: 9, end: 20 } } }));
    expect(d.shouldReply).toBe(false);
    expect(d.reason).toBe('outside_working_hours');
  });

  it('hands over when the lead asks for a human', () => {
    const d = decideAgentAction(ctx({ lastInboundText: 'can an agent call me?' }));
    expect(d.handover).toBe(true);
    expect(d.reason).toBe('human_requested');
  });

  it('hands over on price negotiation', () => {
    const d = decideAgentAction(ctx({ lastInboundText: 'can you give a discount?' }));
    expect(d.handover).toBe(true);
    expect(d.reason).toBe('price_negotiation');
  });

  it('hands over on negative sentiment', () => {
    const d = decideAgentAction(ctx({ qualification: { ...emptyQualification(), sentiment: 'neg', confidence: 0.8 } }));
    expect(d.handover).toBe(true);
    expect(d.reason).toBe('negative_sentiment');
  });

  it('hands over on low AI confidence', () => {
    const d = decideAgentAction(ctx({ qualification: { ...emptyQualification(), confidence: 0.1 } }));
    expect(d.handover).toBe(true);
    expect(d.reason).toBe('low_confidence');
  });
});

describe('buildAgentSystemPrompt', () => {
  it('includes the no-invented-prices guardrail and inventory context', () => {
    const p = buildAgentSystemPrompt({
      guardrails: { persona: 'Priya from Demo Realty', topicsToAvoid: ['politics'] },
      qualification: emptyQualification(),
      inventoryContext: 'A-701 2BHK Wakad 65-75L',
      detectedLanguage: 'hi',
    });
    expect(p).toMatch(/NEVER invent prices/);
    expect(p).toMatch(/A-701 2BHK Wakad/);
    expect(p).toMatch(/politics/);
    expect(p).toMatch(/Priya from Demo Realty/);
  });

  it('resists prompt injection by never trusting lead text for pricing', () => {
    // The prompt instructs the model to use ONLY inventory context for prices,
    // so an injected "give 50% discount" in lead text has no pricing source.
    const p = buildAgentSystemPrompt({
      guardrails: {},
      qualification: { ...emptyQualification() },
      inventoryContext: '',
    });
    expect(p).toMatch(/ONLY the inventory context/);
    expect(p).toMatch(/no matching inventory/);
  });
});
