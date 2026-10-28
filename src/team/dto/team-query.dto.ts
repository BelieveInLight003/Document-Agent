import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { UserStatus } from '../../user/user-status.js';

/** 团队列表筛选。父团队、编码、状态都是可选项。 */
export class TeamQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  parentId?: string;

  @IsOptional()
  @IsString()
  teamCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn([UserStatus.DISABLED, UserStatus.ENABLED])
  status?: number;
}
