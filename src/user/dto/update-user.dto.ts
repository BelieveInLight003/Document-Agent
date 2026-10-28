import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserStatus } from '../user-status.js';

/**
 * 管理员修改用户。字段都可选。
 * 不使用 PartialType：当前 class-transformer 无法继承校验元数据，
 * 全局 whitelist 会把 roleCodes 丢掉，角色修改看起来成功但不会生效。
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(50)
  password?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  realName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatar?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn([UserStatus.DISABLED, UserStatus.ENABLED])
  status?: number;

  /** 传入后整组替换该用户原来的角色。 */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @Matches(/^ROLE_[A-Z0-9_]+$/, { each: true })
  roleCodes?: string[];
}
