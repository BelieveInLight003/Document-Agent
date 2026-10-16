import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import type { DocumentContentFormat } from '../schema/document.content.schema.js';

const SNOWFLAKE_ID = /^\d+$/;
const CONTENT_FORMATS = ['markdown', 'html', 'text'] as const;

export class DocumentChunkDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  length?: number;

  @IsOptional()
  @IsIn(CONTENT_FORMATS)
  format?: DocumentContentFormat;
}

export class CreateDocumentDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  @Matches(SNOWFLAKE_ID)
  categoryId?: string;

  @IsOptional()
  @IsString()
  @Matches(SNOWFLAKE_ID)
  teamId?: string;

  @IsOptional()
  @IsString()
  @Matches(SNOWFLAKE_ID)
  authorId?: string;

  @IsOptional()
  @IsString()
  coverImage?: string;

  @IsOptional()
  @IsString()
  tags?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  status?: number;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsISO8601()
  publishTime?: string;

  @IsOptional()
  @IsString()
  @Matches(SNOWFLAKE_ID)
  createBy?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DocumentChunkDto)
  chunks?: DocumentChunkDto[];
}
