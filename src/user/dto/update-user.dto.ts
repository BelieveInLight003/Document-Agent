import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto.js';

/** 管理员修改用户。字段都可选，传了 roleCodes 会替换原有角色。 */
export class UpdateUserDto extends PartialType(CreateUserDto) {}
