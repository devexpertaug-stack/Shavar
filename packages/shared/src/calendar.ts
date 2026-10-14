/**
 * Calendar adapter (PRD §6 / FR-18). Site visits sync to the agent's calendar.
 * The Mock provider returns a synthetic event id; a Google provider can be
 * dropped in with OAuth when configured.
 */
export interface CalendarEvent {
  title: string;
  startAt: Date;
  endAt: Date;
  location?: string;
  description?: string;
}
export interface CalendarProvider {
  readonly name: string;
  createEvent(event: CalendarEvent): Promise<{ eventId: string }>;
  cancelEvent(eventId: string): Promise<void>;
}

export class MockCalendarProvider implements CalendarProvider {
  readonly name = 'mock-calendar';
  async createEvent(): Promise<{ eventId: string }> {
    return { eventId: `mock_evt_${Date.now()}` };
  }
  async cancelEvent(): Promise<void> {
    /* no-op */
  }
}

export function createCalendarProvider(env: NodeJS.ProcessEnv = process.env): CalendarProvider {
  // A real Google Calendar provider would be constructed here when
  // GOOGLE_OAUTH_* are present. For now the Mock keeps the flow working.
  void env;
  return new MockCalendarProvider();
}

/** Generate bookable slots for the next `days` days at the given local hours. */
export function generateSlots(opts: {
  from?: Date;
  days?: number;
  hours?: number[];
  slotMinutes?: number;
}): Date[] {
  const from = opts.from ?? new Date();
  const days = opts.days ?? 3;
  const hours = opts.hours ?? [11, 13, 15, 17];
  const slots: Date[] = [];
  for (let d = 1; d <= days; d++) {
    for (const h of hours) {
      const slot = new Date(from);
      slot.setDate(slot.getDate() + d);
      slot.setHours(h, 0, 0, 0);
      slots.push(slot);
    }
  }
  return slots;
}
