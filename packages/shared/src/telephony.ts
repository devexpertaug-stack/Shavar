/**
 * Telephony adapter (PRD §6 / FR-14). Click-to-call connects the agent and the
 * lead via masked numbers; the provider posts call webhooks (status, recording).
 */
export interface ClickToCallInput {
  agentNumber: string;
  customerNumber: string;
  callerId?: string;
}
export interface ClickToCallResult {
  providerCallId: string;
}

export interface TelephonyProvider {
  readonly name: string;
  clickToCall(input: ClickToCallInput): Promise<ClickToCallResult>;
  /** Parse a provider call webhook into a normalized shape. */
  parseWebhook(body: Record<string, unknown>): {
    providerCallId: string;
    status: string;
    durationSec?: number;
    recordingUrl?: string;
  };
}

export class MockTelephonyProvider implements TelephonyProvider {
  readonly name = 'mock-telephony';
  async clickToCall(): Promise<ClickToCallResult> {
    return { providerCallId: `mock_call_${Date.now()}` };
  }
  parseWebhook(body: Record<string, unknown>) {
    return {
      providerCallId: String(body.CallSid ?? body.callId ?? ''),
      status: String(body.Status ?? body.status ?? 'completed'),
      durationSec: body.Duration ? Number(body.Duration) : undefined,
      recordingUrl: (body.RecordingUrl as string) ?? undefined,
    };
  }
}

export class ExotelProvider implements TelephonyProvider {
  readonly name = 'exotel';
  constructor(
    private readonly config: { sid: string; apiKey: string; apiToken: string; subdomain?: string; callerId?: string },
  ) {}

  async clickToCall(input: ClickToCallInput): Promise<ClickToCallResult> {
    const sub = this.config.subdomain ?? 'api.exotel.com';
    const url = `https://${this.config.apiKey}:${this.config.apiToken}@${sub}/v1/Accounts/${this.config.sid}/Calls/connect.json`;
    const form = new URLSearchParams({
      From: input.agentNumber,
      To: input.customerNumber,
      CallerId: input.callerId ?? this.config.callerId ?? '',
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) throw new Error(`Exotel connect failed: ${res.status}`);
    const json = (await res.json()) as { Call?: { Sid?: string } };
    return { providerCallId: String(json.Call?.Sid ?? '') };
  }

  parseWebhook(body: Record<string, unknown>) {
    return {
      providerCallId: String(body.CallSid ?? ''),
      status: String(body.Status ?? 'completed'),
      durationSec: body.DialCallDuration ? Number(body.DialCallDuration) : undefined,
      recordingUrl: (body.RecordingUrl as string) ?? undefined,
    };
  }
}

export function createTelephonyProvider(env: NodeJS.ProcessEnv = process.env): TelephonyProvider {
  if (env.EXOTEL_SID && env.EXOTEL_API_KEY && env.EXOTEL_API_TOKEN) {
    return new ExotelProvider({
      sid: env.EXOTEL_SID,
      apiKey: env.EXOTEL_API_KEY,
      apiToken: env.EXOTEL_API_TOKEN,
      subdomain: env.EXOTEL_SUBDOMAIN,
    });
  }
  return new MockTelephonyProvider();
}
