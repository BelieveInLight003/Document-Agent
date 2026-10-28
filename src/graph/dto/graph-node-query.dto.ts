import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const GRAPH_NODE_LABELS = ['Document', 'Chunk', 'Entity'] as const;

/** 按关键词检索图谱节点。label 可限定文档、切片或实体。 */
export class GraphNodeQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  keyword: string;

  @IsOptional()
  @IsIn(GRAPH_NODE_LABELS)
  label?: (typeof GRAPH_NODE_LABELS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number;
}
