import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class UpsertRoutingRuleDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiProperty({ description: 'Conditions JSON (source/project/location/language/tier)' })
  @IsObject()
  conditions!: Record<string, unknown>;

  @ApiProperty({ description: 'Action JSON (strategy + userId/teamId/requireLanguage)' })
  @IsObject()
  action!: Record<string, unknown>;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
