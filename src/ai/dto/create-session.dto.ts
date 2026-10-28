import { IsOptional, IsString, MaxLength } from 'class-validator';

/** 新建会话。不传标题时记为「新会话」，第一条问题会改成标题。 */
export class CreateSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
