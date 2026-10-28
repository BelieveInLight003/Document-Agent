import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator.js';
import { PermissionCode } from '../permission/permission-code.js';
import { Permissions } from '../permission/permissions.decorator.js';
import { AssignRolesDto } from './dto/assign-roles.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UserQueryDto } from './dto/user-query.dto.js';
import { RoleCode } from './role-code.js';
import { UserService, type UserProfile } from './user.service.js';

/** 用户资料和角色绑定。登录和令牌仍走 /auth。 */
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /** 当前登录用户。令牌守卫已经查过库。 */
  @Get('me')
  me(@Req() request: Request & { user: UserProfile }) {
    return request.user;
  }

  /** 修改自己的资料。不能改角色和启用状态。 */
  @Patch('me')
  updateMe(
    @Req() request: Request & { user: UserProfile },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.userService.updateProfile(request.user.id, dto);
  }

  /** 管理员创建用户，可同时指定角色。 */
  @Roles(RoleCode.ADMIN)
  @Permissions(PermissionCode.SYSTEM_USER)
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.userService.create(dto);
  }

  /** 管理员分页查询用户。 */
  @Roles(RoleCode.ADMIN)
  @Permissions(PermissionCode.SYSTEM_USER)
  @Get()
  findAll(@Query() query: UserQueryDto) {
    return this.userService.findAll(query);
  }

  /** 管理员查看一个用户，含角色编码。 */
  @Roles(RoleCode.ADMIN)
  @Permissions(PermissionCode.SYSTEM_USER)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  /** 管理员修改用户。传入 roleCodes 会替换原角色。 */
  @Roles(RoleCode.ADMIN)
  @Permissions(PermissionCode.SYSTEM_USER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.userService.update(id, dto);
  }

  /** 管理员替换该用户的全部角色。 */
  @Roles(RoleCode.ADMIN)
  @Permissions(PermissionCode.SYSTEM_USER)
  @Put(':id/roles')
  assignRoles(@Param('id') id: string, @Body() dto: AssignRolesDto) {
    return this.userService.assignRoles(id, dto.roleCodes);
  }

  /** 管理员软删除用户。不能删除自己。 */
  @Roles(RoleCode.ADMIN)
  @Permissions(PermissionCode.SYSTEM_USER)
  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Req() request: Request & { user: UserProfile },
  ) {
    return this.userService.remove(id, request.user.id);
  }
}
