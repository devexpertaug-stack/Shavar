import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ enum: ['text', 'media', 'template', 'interactive'] })
  @IsIn(['text', 'media', 'template', 'interactive'])
  kind!: 'text' | 'media' | 'template' | 'interactive';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @ApiPropertyOptional({ description: 'Template name (when kind=template)' })
  @IsOptional()
  @IsString()
  templateName?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  templateParams?: string[];
}

export class MessageHistoryQuery {
  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit = 50;
}

export class UpsertTemplateDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ default: 'en' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  body!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;
}
