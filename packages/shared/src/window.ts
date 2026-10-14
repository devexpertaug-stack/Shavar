/**
 * WhatsApp 24-hour customer-service window (PRD §4.2 / FR-4, Task 5).
 *
 * Inside the window (<= 24h since the last inbound message from the contact)
 * free-form session messages are allowed. Outside it, only pre-approved
 * templates may be sent.
 */
export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinSessionWindow(
  lastInboundAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastInboundAt) return false;
  const last = typeof lastInboundAt === 'string' ? new Date(lastInboundAt) : lastInboundAt;
  if (Number.isNaN(last.getTime())) return false;
  return now.getTime() - last.getTime() <= SESSION_WINDOW_MS;
}

export type OutboundKind = 'text' | 'media' | 'template' | 'interactive';

/**
 * Decide whether an outbound of the given kind is allowed right now. Templates
 * are always allowed; everything else requires an open 24h window.
 */
export function canSendOutbound(
  kind: OutboundKind,
  lastInboundAt: Date | string | null | undefined,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: string } {
  if (kind === 'template') return { ok: true };
  if (isWithinSessionWindow(lastInboundAt, now)) return { ok: true };
  return {
    ok: false,
    reason: 'Outside the 24-hour window; only approved templates can be sent',
  };
}

/** Common STOP/opt-out keywords (case-insensitive, trimmed). */
const OPT_OUT_KEYWORDS = new Set([
  'stop',
  'unsubscribe',
  'optout',
  'opt out',
  'opt-out',
  'cancel',
  'band karo',
  'bandh karo',
  'ruko',
]);

export function isOptOutMessage(text: string | null | undefined): boolean {
  if (!text) return false;
  return OPT_OUT_KEYWORDS.has(text.trim().toLowerCase());
}
