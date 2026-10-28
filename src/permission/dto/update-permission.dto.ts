import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PERMISSION_TYPES } from '../permission-type.js';
import { UserStatus } from '../../user/user-status.js';

/** 修改权限。只更新传入的字段。 */
export class UpdatePermissionDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  parentId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  permissionName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  permissionCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn(PERMISSION_TYPES)
  permissionType?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  menuUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiUrl?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
  method?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort?: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn([UserStatus.DISABLED, UserStatus.ENABLED])
  status?: number;
}
