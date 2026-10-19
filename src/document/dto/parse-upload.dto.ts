import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

const SNOWFLAKE_ID = /^\d+$/;

/** 上传时可选的元数据。标题和摘要没传时，从解析出的 Markdown 里提取。 */
export class ParseUploadDto {
  @IsOptional()
  @IsString()
  title?: string;

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
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsString()
  @Matches(SNOWFLAKE_ID)
  createBy?: string;
}
