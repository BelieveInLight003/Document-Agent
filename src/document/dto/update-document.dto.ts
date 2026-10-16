import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { DocumentChunkDto } from './create-document.dto.js';

const SNOWFLAKE_ID = /^\d+$/;

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

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

  @IsOptional()
  @IsString()
  @Matches(SNOWFLAKE_ID)
  updateBy?: string;
}
