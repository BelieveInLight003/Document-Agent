import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from './entities/role.entity.js';
import { UserRole } from './entities/user-role.entity.js';
import { User } from './entities/user.entity.js';
import { RoleController } from './role.controller.js';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, Role, UserRole])],
  controllers: [UserController, RoleController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
