import { Controller, Get } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator.js';
import { RoleCode } from './role-code.js';
import { UserService } from './user.service.js';

/** 角色是预置数据。这里只提供查询，供分配用户角色时使用。 */
@Controller('roles')
export class RoleController {
  constructor(private readonly userService: UserService) {}

  @Roles(RoleCode.ADMIN)
  @Get()
  findAll() {
    return this.userService.listRoles();
  }
}
