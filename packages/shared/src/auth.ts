import { z } from 'zod';
import { RoleSchema } from './roles';

/** JWT access-token payload. Carries tenant + role so guards can authorize. */
export const AccessTokenPayloadSchema = z.object({
  sub: z.string().uuid(), // user id
  tid: z.string().uuid(), // tenant id
  role: RoleSchema,
  teamId: z.string().uuid().nullable(),
  email: z.string().email(),
});
export type AccessTokenPayload = z.infer<typeof AccessTokenPayloadSchema>;

/** Refresh-token payload. tv = tokenVersion for revocation on logout. */
export const RefreshTokenPayloadSchema = z.object({
  sub: z.string().uuid(),
  tid: z.string().uuid(),
  tv: z.number().int().nonnegative(),
});
export type RefreshTokenPayload = z.infer<typeof RefreshTokenPayloadSchema>;

export const LoginRequestSchema = z.object({
  // slug lets a user disambiguate which tenant they are logging into.
  tenantSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const InviteRequestSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: RoleSchema,
  teamId: z.string().uuid().nullable().optional(),
  languages: z.array(z.string()).optional(),
});
export type InviteRequest = z.infer<typeof InviteRequestSchema>;

export const AcceptInviteRequestSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8),
});
export type AcceptInviteRequest = z.infer<typeof AcceptInviteRequestSchema>;

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: RoleSchema,
  teamId: z.string().uuid().nullable(),
  languages: z.array(z.string()),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  user: AuthUserSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
