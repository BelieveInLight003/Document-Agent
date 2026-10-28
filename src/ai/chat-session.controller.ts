import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PermissionCode } from '../permission/permission-code.js';
import { Permissions } from '../permission/permissions.decorator.js';
import type { UserProfile } from '../user/user.service.js';
import { AskDto } from './dto/ask.dto.js';
import { CreateSessionDto } from './dto/create-session.dto.js';
import { UpdateSessionDto } from './dto/update-session.dto.js';
import { ChatSessionService } from './chat-session.service.js';

/** 当前用户的问答会话。消息挂在会话上，删除会话会级联删掉消息。 */
@Controller('ai/sessions')
@Permissions(PermissionCode.SEARCH)
export class ChatSessionController {
  constructor(private readonly chatSessions: ChatSessionService) {}

  @Get()
  list(@Req() request: Request & { user: UserProfile }) {
    return this.chatSessions.list(request.user.id);
  }

  @Post()
  create(
    @Req() request: Request & { user: UserProfile },
    @Body() dto: CreateSessionDto,
  ) {
    return this.chatSessions.create(request.user.id, dto.title);
  }

  @Get(':id')
  findOne(
    @Req() request: Request & { user: UserProfile },
    @Param('id') id: string,
  ) {
    return this.chatSessions.findOne(request.user.id, id);
  }

  @Patch(':id')
  update(
    @Req() request: Request & { user: UserProfile },
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.chatSessions.update(request.user.id, id, dto.title);
  }

  @Delete(':id')
  remove(
    @Req() request: Request & { user: UserProfile },
    @Param('id') id: string,
  ) {
    return this.chatSessions.remove(request.user.id, id);
  }

  @Post(':id/messages')
  ask(
    @Req() request: Request & { user: UserProfile },
    @Param('id') id: string,
    @Body() dto: AskDto,
  ) {
    return this.chatSessions.ask(request.user.id, id, dto.question, dto.limit);
  }
}
