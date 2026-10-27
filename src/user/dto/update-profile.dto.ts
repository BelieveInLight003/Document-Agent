import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** 当前用户改自己的资料。改密码时必须带原密码。 */
export class UpdateProfileDto {
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
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  oldPassword?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(50)
  password?: string;
}
