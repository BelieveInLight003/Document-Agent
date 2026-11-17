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

  /**
   * 登记切片向量队列的处理函数。这里还不取消息，只告诉消费者：
   * knowledge_hub.document.published 里来消息时调用 handler。
   * 真正开始消费要等应用启动完成。
   */
  subscribe<T>(handler: MessageHandler<T>) {
    this.consumer.register(getRabbitmqConfig().queues.published, handler);
  }

  /** 登记全文索引队列的处理函数。消息来自 knowledge_hub.document.keyword。 */
  subscribeKeyword<T>(handler: MessageHandler<T>) {
    this.consumer.register(getRabbitmqConfig().queues.keyword, handler);
  }

  /** 登记图谱队列的处理函数。消息来自 knowledge_hub.document.graph。 */
  subscribeGraph<T>(handler: MessageHandler<T>) {
    this.consumer.register(getRabbitmqConfig().queues.graph, handler);
  }
}
