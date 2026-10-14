import type { AuthUser, LoginResponse } from '@estateflow/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const BASE = `${API_URL}/api/v1`;

/** In-memory access token. Refresh token lives in an httpOnly cookie. */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  // Transparent refresh on a single 401 (expired access token).
  if (res.status === 401 && retry && path !== '/auth/refresh' && path !== '/auth/login') {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, init, false);
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = (body.message as string) ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (!res.ok) return false;
    const data = (await res.json()) as LoginResponse;
    setAccessToken(data.accessToken);
    return true;
  } catch {
    return false;
  }
}

export const api = {
  login: (tenantSlug: string, email: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ tenantSlug, email, password }),
    }),
  refresh: tryRefresh,
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<AuthUser>('/users/me'),
  users: () => request<AuthUser[]>('/users'),

  // --- leads (Task 3) ---
  leads: (query = '') => request<LeadListResponse>(`/leads${query ? `?${query}` : ''}`),
  lead: (id: string) => request<LeadDetail>(`/leads/${id}`),
  board: () => request<BoardResponse>('/leads/board'),
  stages: () => request<PipelineStage[]>('/leads/stages'),
  createLead: (body: Record<string, unknown>) =>
    request<LeadDetail>('/leads', { method: 'POST', body: JSON.stringify(body) }),
  changeStage: (id: string, stage: string, lostReason?: string) =>
    request<LeadDetail>(`/leads/${id}/stage`, {
      method: 'PATCH',
      body: JSON.stringify({ stage, lostReason }),
    }),
  assignLead: (id: string, assignedTo: string | null) =>
    request<LeadDetail>(`/leads/${id}/assign`, {
      method: 'PATCH',
      body: JSON.stringify({ assignedTo }),
    }),
  addNote: (id: string, body: string) =>
    request<unknown>(`/leads/${id}/notes`, { method: 'POST', body: JSON.stringify({ body }) }),
  takeover: (id: string) => request<LeadDetail>(`/leads/${id}/takeover`, { method: 'PATCH' }),
  releaseAi: (id: string) => request<LeadDetail>(`/leads/${id}/release`, { method: 'PATCH' }),

  // --- settings / providers (Task 4) ---
  providers: () => request<ProviderSummary[]>('/settings/providers'),
  upsertProvider: (body: Record<string, unknown>) =>
    request<ProviderSummary>('/settings/providers', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteProvider: (id: string) =>
    request<unknown>(`/settings/providers/${id}`, { method: 'DELETE' }),

  // --- inbox / messaging (Task 5) ---
  conversations: () => request<Conversation[]>('/inbox/conversations'),
  thread: (leadId: string) => request<ThreadResponse>(`/leads/${leadId}/messages`),
  sendMessage: (leadId: string, body: Record<string, unknown>) =>
    request<WaMessage>(`/leads/${leadId}/messages`, { method: 'POST', body: JSON.stringify(body) }),
  templates: () => request<Template[]>('/templates'),
  syncTemplates: () => request<{ synced: number }>('/templates/sync', { method: 'POST' }),

  // --- inventory (Task 9) ---
  projectsList: () => request<InventoryProject[]>('/projects'),
  units: (projectId?: string) =>
    request<InventoryUnit[]>(`/units${projectId ? `?projectId=${projectId}` : ''}`),
  matchUnits: (leadId: string) => request<MatchedUnit[]>(`/units/match?leadId=${leadId}`),
  sendUnit: (leadId: string, unitId: string, what: 'brochure' | 'location') =>
    request<{ ok: boolean }>('/units/send', { method: 'POST', body: JSON.stringify({ leadId, unitId, what }) }),

  // --- tele-caller (Task 12) ---
  nextBestCalls: () => request<QueueCard[]>('/queue/next-best-calls'),
  clickToCall: (leadId: string, agentNumber: string) =>
    request<{ id: string }>('/calls/click-to-call', { method: 'POST', body: JSON.stringify({ leadId, agentNumber }) }),
  callOutcome: (callId: string, outcome: string, nextFollowupAt?: string) =>
    request<unknown>(`/calls/${callId}/outcome`, { method: 'POST', body: JSON.stringify({ outcome, nextFollowupAt }) }),

  // --- site visits (Task 13) ---
  visits: () => request<SiteVisit[]>('/site-visits'),
  checkIn: (id: string, geo: string) => request<unknown>(`/site-visits/${id}/checkin`, { method: 'POST', body: JSON.stringify({ geo }) }),
  checkOut: (id: string, geo: string, feedback?: string) =>
    request<unknown>(`/site-visits/${id}/checkout`, { method: 'POST', body: JSON.stringify({ geo, feedback }) }),
};

export interface SiteVisit {
  id: string;
  slotAt: string;
  status: string;
  checkinGeo: string | null;
  feedback: string | null;
  lead?: { contact: { name: string | null; phoneE164: string } };
}

export interface QueueCard {
  leadId: string;
  score: number;
  tier: 'HOT' | 'WARM' | 'COLD';
  contact: { name: string | null; phoneE164: string };
  brief: string;
}

export interface InventoryProject {
  id: string;
  name: string;
  location: string;
  amenities: string[];
}
export interface InventoryUnit {
  id: string;
  name: string;
  bhk: number;
  priceMin: number;
  priceMax: number;
  isAvailable: boolean;
  project?: { name: string; location: string };
}
export interface MatchedUnit {
  id: string;
  name: string;
  bhk: number;
  priceMin: number;
  priceMax: number;
  projectName: string;
  location: string;
  distance: number | null;
}

export interface Conversation {
  leadId: string;
  contact: { name: string | null; phoneE164: string; optedIn: boolean };
  stage: string;
  tier: 'HOT' | 'WARM' | 'COLD';
  lastInboundAt: string | null;
  lastMessage: WaMessage | null;
  aiActive: boolean;
}
export interface ThreadResponse {
  lead: {
    id: string;
    stage: string;
    tier: 'HOT' | 'WARM' | 'COLD';
    aiActive: boolean;
    lastInboundAt: string | null;
    contact: { name: string | null; phoneE164: string; optedIn: boolean };
  };
  messages: WaMessage[];
}
export interface Template {
  id: string;
  name: string;
  language: string;
  body: string;
  paramCount: number;
  status: string;
}

export interface ProviderSummary {
  id: string;
  type: string;
  tenantKey: string;
  isActive: boolean;
  webhookUrl: string;
  hasApiKey: boolean;
  hasWebhookSecret: boolean;
  baseUrl: string | null;
}

export interface WaMessage {
  id: string;
  leadId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  body: string | null;
  mediaUrl: string | null;
  transcript?: string | null;
  status: string;
  sentBy: string;
  createdAt: string;
}

// ---- lead view types (shapes returned by the API) ----
export interface LeadContact {
  id: string;
  phoneE164: string;
  name: string | null;
  language: string | null;
}
export interface LeadSummary {
  id: string;
  source: string;
  stage: string;
  tier: 'HOT' | 'WARM' | 'COLD';
  score: number;
  assignedTo: string | null;
  nextFollowupAt: string | null;
  updatedAt: string;
  contact: LeadContact;
}
export interface LeadActivity {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  userId: string | null;
  createdAt: string;
}
export interface LeadDetail extends LeadSummary {
  lostReason: string | null;
  qualification: Record<string, unknown>;
  activities: LeadActivity[];
}
export interface LeadListResponse {
  items: LeadSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  isTerminal: boolean;
}
export interface BoardResponse {
  stages: PipelineStage[];
  columns: { stage: string; leads: LeadSummary[] }[];
}
