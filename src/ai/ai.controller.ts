import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { documentViewer } from '../document/document-access.js';
import { PermissionCode } from '../permission/permission-code.js';
import { Permissions } from '../permission/permissions.decorator.js';
import type { UserProfile } from '../user/user.service.js';
import { AiService } from './ai.service.js';
import { AskDto } from './dto/ask.dto.js';

/** 混合检索和基于资料的对话。需要登录，以及搜索权限。检索结果再按文档阅读权限过滤。 */
@Controller('ai')
@Permissions(PermissionCode.SEARCH)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /** 关键词与向量融合，返回当前用户能读的已发布切片，不生成回答。 */
  @Post('retrieve')
  retrieve(@Req() request: Request & { user: UserProfile }, @Body() dto: AskDto) {
    return this.aiService.retrieve(documentViewer(request.user), dto);
  }

  /** 用混合检索结果作为上下文，让对话模型作答。看不到的文档不会进入上下文。 */
  @Post('chat')
  chat(@Req() request: Request & { user: UserProfile }, @Body() dto: AskDto) {
    return this.aiService.chat(documentViewer(request.user), dto);
  }
}
