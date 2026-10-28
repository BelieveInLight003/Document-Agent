import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { UserStatus } from '../user-status.js';

/** 新建角色。permissionIds 在创建时一并绑定，空数组表示暂不授权。 */
export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  roleName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^ROLE_[A-Z0-9_]+$/)
  roleCode: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn([UserStatus.DISABLED, UserStatus.ENABLED])
  status?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Matches(/^\d+$/, { each: true })
  permissionIds?: string[];
}
