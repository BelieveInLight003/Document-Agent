import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** 混合检索和对话共用。question 是用户问题，limit 是注入上下文的切片条数。 */
export class AskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  question: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  limit?: number;
}
