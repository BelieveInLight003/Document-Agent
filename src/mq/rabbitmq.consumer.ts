import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import { getRabbitmqConfig } from './rabbitmq.config.js';
import { RabbitmqPublisher } from './rabbitmq.publisher.js';

export type MessageHandler<T> = (message: T) => Promise<void> | void;

/**
 * 订阅已绑定的队列。
 * 处理函数由业务侧注册；应用启动完成后再开始消费，保证处理函数已经就位。
 */
@Injectable()
export class RabbitmqConsumer
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RabbitmqConsumer.name);
  private channel?: Channel;
  private handler?: MessageHandler<unknown>;
  private listening = false;
  private starting?: Promise<void>;
  private readonly maxRetry = 3;

  constructor(private readonly publisher: RabbitmqPublisher) {}

  register<T>(handler: MessageHandler<T>) {
    this.handler = handler as MessageHandler<unknown>;
  }

  async onApplicationBootstrap() {
    try {
      await this.ensureListening();
    } catch (error) {
      const detail = error instanceof Error ? error.message : '订阅失败';
      this.logger.warn(`RabbitMQ 订阅未启动：${detail}`);
    }
  }

  /** 尚未订阅时再试一次。启动时 RabbitMQ 没起来，发布前还能补上消费者。 */
  async ensureListening() {
    if (this.listening) {
      return;
    }
    if (!this.starting) {
      this.starting = this.listen().finally(() => {
        this.starting = undefined;
      });
    }
    await this.starting;
  }

  async onModuleDestroy() {
    await this.channel?.close().catch(() => undefined);
    this.channel = undefined;
    this.listening = false;
  }

  private async listen() {
    if (this.listening) {
      return;
    }
    if (!this.handler) {
      this.logger.warn('还没有订阅处理函数，队列里的消息会先保留');
      return;
    }

    const config = getRabbitmqConfig();
    const channel = await this.publisher.openChannel();
    this.channel = channel;
    await channel.consume(config.queues.published, (message) => {
      void this.handleMessage(channel, message);
    });
    this.listening = true;
    this.logger.log(`已订阅队列 queue=${config.queues.published}`);
  }

  private async handleMessage(channel: Channel, message: ConsumeMessage | null) {
    if (!message || !this.handler) {
      return;
    }
    try {
      const payload = JSON.parse(message.content.toString()) as unknown;
      await this.handler(payload);
      channel.ack(message);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '处理失败';
      this.logger.error(`消息处理失败：${detail}`);
      await this.retryOrDrop(channel, message);
    }
  }

  private async retryOrDrop(channel: Channel, message: ConsumeMessage) {
    const retry = Number(message.properties.headers?.['x-retry'] ?? 0);
    if (retry >= this.maxRetry) {
      channel.nack(message, false, false);
      return;
    }

    const config = getRabbitmqConfig();
    channel.publish(
      config.exchange,
      message.fields.routingKey,
      message.content,
      {
        persistent: true,
        contentType: 'application/json',
        headers: { ...message.properties.headers, 'x-retry': retry + 1 },
      },
    );
    channel.ack(message);
  }
}
