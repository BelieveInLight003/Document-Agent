import { ArrayMinSize, IsArray, IsString, Matches } from 'class-validator';

/** 替换全部关联时允许空数组，表示清空。 */
export class AssignPermissionsDto {
  @IsArray()
  @IsString({ each: true })
  @Matches(/^\d+$/, { each: true })
  permissionIds: string[];
}

/** 合并或删除关联时至少指定一个权限。 */
export class ChangePermissionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @Matches(/^\d+$/, { each: true })
  permissionIds: string[];
}
