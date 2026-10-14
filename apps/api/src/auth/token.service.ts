import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import {
  AccessTokenPayloadSchema,
  RefreshTokenPayloadSchema,
  type AccessTokenPayload,
  type RefreshTokenPayload,
} from '@estateflow/shared';
import { AUTH_CONFIG, type AuthConfig } from '../config/auth.config';

@Injectable()
export class TokenService {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  signAccess(payload: AccessTokenPayload): string {
    return jwt.sign(payload, this.config.jwtSecret, {
      expiresIn: this.config.accessTtl,
    } as jwt.SignOptions);
  }

  signRefresh(payload: RefreshTokenPayload): string {
    return jwt.sign(payload, this.config.jwtRefreshSecret, {
      expiresIn: this.config.refreshTtl,
    } as jwt.SignOptions);
  }

  verifyAccess(token: string): AccessTokenPayload {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret);
      return AccessTokenPayloadSchema.parse(decoded);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  verifyRefresh(token: string): RefreshTokenPayload {
    try {
      const decoded = jwt.verify(token, this.config.jwtRefreshSecret);
      return RefreshTokenPayloadSchema.parse(decoded);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
