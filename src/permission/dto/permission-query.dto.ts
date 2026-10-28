import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { UserStatus } from '../../user/user-status.js';

/** 权限列表筛选。父权限、编码、状态都是可选项。 */
export class PermissionQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  parentId?: string;

  @IsOptional()
  @IsString()
  permissionCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn([UserStatus.DISABLED, UserStatus.ENABLED])
  status?: number;
}
