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

/** 新建权限。parentId 不传时挂在根节点 0。 */
export class CreatePermissionDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  parentId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  permissionName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  permissionCode: string;

  @Type(() => Number)
  @IsIn(PERMISSION_TYPES)
  permissionType: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  menuUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiUrl?: string;

  @IsOptional()
  @IsString()
  @IsIn(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
  method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;

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
