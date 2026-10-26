import { Injectable } from '@nestjs/common';
import { getRabbitmqConfig } from './rabbitmq.config.js';
import { RabbitmqConsumer, type MessageHandler } from './rabbitmq.consumer.js';
import { RabbitmqPublisher } from './rabbitmq.publisher.js';

/** 对外只暴露发布和注册处理函数，路由与队列留在 mq 内部。 */
@Injectable()
export class MqService {
  constructor(
    private readonly publisher: RabbitmqPublisher,
    private readonly consumer: RabbitmqConsumer,
  ) {}

  async publish(payload: unknown) {
    await this.consumer.ensureListening();
    return this.publisher.publish(
      getRabbitmqConfig().routingKeys.published,
      payload,
    );
  }

  /** 整篇文档的关键词索引链路，不走切片。 */
  async publishKeyword(payload: unknown) {
    await this.consumer.ensureListening();
    return this.publisher.publish(
      getRabbitmqConfig().routingKeys.keyword,
      payload,
    );
  }

  /** 文档图谱链路。 */
  async publishGraph(payload: unknown) {
    await this.consumer.ensureListening();
    return this.publisher.publish(
      getRabbitmqConfig().routingKeys.graph,
      payload,
    );
  }

  subscribe<T>(handler: MessageHandler<T>) {
    this.consumer.register(getRabbitmqConfig().queues.published, handler);
  }

  subscribeKeyword<T>(handler: MessageHandler<T>) {
    this.consumer.register(getRabbitmqConfig().queues.keyword, handler);
  }

  subscribeGraph<T>(handler: MessageHandler<T>) {
    this.consumer.register(getRabbitmqConfig().queues.graph, handler);
  }
}
