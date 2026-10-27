import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ROLE_CODES } from '../role-code.js';
import { UserStatus } from '../user-status.js';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(50)
  password: string;

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

  /** 不传则绑定普通用户。 */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsIn(ROLE_CODES, { each: true })
  roleCodes?: string[];
}
