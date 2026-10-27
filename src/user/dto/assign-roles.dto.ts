import { ArrayMinSize, IsArray, IsIn, IsString } from 'class-validator';
import { ROLE_CODES } from '../role-code.js';

/** 替换用户的全部角色，至少保留一个。 */
export class AssignRolesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsIn(ROLE_CODES, { each: true })
  roleCodes: string[];
}
