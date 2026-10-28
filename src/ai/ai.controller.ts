import { Body, Controller, Post } from '@nestjs/common';
import { PermissionCode } from '../permission/permission-code.js';
import { Permissions } from '../permission/permissions.decorator.js';
import { AiService } from './ai.service.js';
import { AskDto } from './dto/ask.dto.js';

/** 混合检索和基于资料的对话。需要登录，以及搜索权限。 */
@Controller('ai')
@Permissions(PermissionCode.SEARCH)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /** 关键词与向量融合，返回切片原文，不生成回答。 */
  @Post('retrieve')
  retrieve(@Body() dto: AskDto) {
    return this.aiService.retrieve(dto);
  }

  /** 用混合检索结果作为上下文，让对话模型作答。 */
  @Post('chat')
  chat(@Body() dto: AskDto) {
    return this.aiService.chat(dto);
  }
}
