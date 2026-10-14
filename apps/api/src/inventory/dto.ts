import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateProjectDto {
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiProperty() @IsString() @MinLength(1) location!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) amenities?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() mapPin?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() brochureUrl?: string;
}

export class CreateUnitDto {
  @ApiProperty() @IsString() projectId!: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) bhk!: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() carpetArea?: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) priceMin!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) priceMax!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() facing?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() floor?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isAvailable?: boolean;
}

export class SendUnitDto {
  @ApiProperty() @IsString() leadId!: string;
  @ApiProperty() @IsString() unitId!: string;
  @ApiPropertyOptional({ enum: ['brochure', 'location'] }) @IsOptional() @IsString() what?: 'brochure' | 'location';
}
