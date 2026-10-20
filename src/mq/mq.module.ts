import { Module } from '@nestjs/common';
import { MqService } from './mq.service.js';
import { RabbitmqConsumer } from './rabbitmq.consumer.js';
import { RabbitmqPublisher } from './rabbitmq.publisher.js';

/**
 * RabbitMQ 连接、绑定发布和订阅。
 * 外部只使用 MqService，不包含具体业务处理。
 */
@Module({
  providers: [RabbitmqPublisher, RabbitmqConsumer, MqService],
  exports: [MqService],
})
export class MqModule {}
