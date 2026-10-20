import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DocumentContent,
  DocumentContentSchema,
} from '../document/schema/document.content.schema.js';
import { MqModule } from '../mq/mq.module.js';
import { PipelineManagerService } from './pipeline-manager.service.js';

/**
 * 文档发布后的业务处理。
 * 队列连接和收发由 MqModule 提供。
 */
@Module({
  imports: [
    MqModule,
    MongooseModule.forFeature([
      { name: DocumentContent.name, schema: DocumentContentSchema },
    ]),
  ],
  providers: [PipelineManagerService],
  exports: [PipelineManagerService],
})
export class PipelineManagerModule {}
