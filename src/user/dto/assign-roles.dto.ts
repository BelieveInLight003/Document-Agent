import { ArrayMinSize, IsArray, IsString, Matches } from 'class-validator';

/** 替换用户的全部角色，至少保留一个。编码必须是已存在的角色。 */
export class AssignRolesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @Matches(/^ROLE_[A-Z0-9_]+$/, { each: true })
  roleCodes: string[];
}
