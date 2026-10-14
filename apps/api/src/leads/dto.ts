import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { LeadSource, Tier } from '@estateflow/shared';

export class CreateLeadDto {
  @ApiProperty({ example: '9812345678' })
  @IsString()
  phone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ enum: LeadSource })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  stage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedTo?: string | null;
}

export class UpdateStageDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  stage!: string;

  @ApiPropertyOptional({ description: 'Required when moving to a terminal Lost stage' })
  @IsOptional()
  @IsString()
  lostReason?: string;
}

export class AssignDto {
  @ApiProperty({ nullable: true })
  @IsOptional()
  @IsUUID()
  assignedTo!: string | null;
}

export class AddNoteDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  body!: string;
}

export class LeadFiltersDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  stage?: string;

  @ApiPropertyOptional({ enum: Tier })
  @IsOptional()
  @IsEnum(Tier)
  tier?: Tier;

  @ApiPropertyOptional({ enum: LeadSource })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}
