import { describe, it, expect } from 'vitest';
import { isWithinSessionWindow, canSendOutbound, isOptOutMessage } from './window';

const now = new Date('2026-02-14T12:00:00Z');

describe('isWithinSessionWindow', () => {
  it('is true just under 24h', () => {
    expect(isWithinSessionWindow(new Date('2026-02-13T12:00:01Z'), now)).toBe(true);
  });
  it('is false just over 24h', () => {
    expect(isWithinSessionWindow(new Date('2026-02-13T11:59:59Z'), now)).toBe(false);
  });
  it('is false when there has been no inbound message', () => {
    expect(isWithinSessionWindow(null, now)).toBe(false);
  });
});

describe('canSendOutbound', () => {
  it('allows a template regardless of window', () => {
    expect(canSendOutbound('template', null, now).ok).toBe(true);
  });
  it('allows text inside the window', () => {
    expect(canSendOutbound('text', new Date('2026-02-14T06:00:00Z'), now).ok).toBe(true);
  });
  it('blocks text outside the window', () => {
    const r = canSendOutbound('text', new Date('2026-02-12T06:00:00Z'), now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/24-hour window/);
  });
  it('blocks media when there is no open window', () => {
    expect(canSendOutbound('media', null, now).ok).toBe(false);
  });
});

describe('isOptOutMessage', () => {
  it('detects STOP keywords case-insensitively', () => {
    expect(isOptOutMessage('STOP')).toBe(true);
    expect(isOptOutMessage(' stop ')).toBe(true);
    expect(isOptOutMessage('Unsubscribe')).toBe(true);
    expect(isOptOutMessage('band karo')).toBe(true);
  });
  it('does not match normal messages', () => {
    expect(isOptOutMessage('I want to stop by the site tomorrow')).toBe(false);
    expect(isOptOutMessage('')).toBe(false);
    expect(isOptOutMessage(null)).toBe(false);
  });
});
