import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import amqp, { type Channel, type ChannelModel } from 'amqplib';
import { getRabbitmqConfig } from './rabbitmq.config.js';

type AmqpClient = {
  connect: (url: string) => Promise<ChannelModel>;
};

/** 连接 RabbitMQ，声明交换机和队列并完成绑定，再负责发布。 */
@Injectable()
export class RabbitmqPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqPublisher.name);
  private connection?: ChannelModel;
  private channel?: Channel;

  async onModuleInit() {
    try {
      await this.ensureReady();
    } catch (error) {
      const detail = error instanceof Error ? error.message : '连接失败';
      this.logger.warn(`RabbitMQ 暂未连接：${detail}`);
    }
  }

  async onModuleDestroy() {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
    this.channel = undefined;
    this.connection = undefined;
  }

  /** 向已绑定的交换机发布一条消息。 */
  async publish(routingKey: string, payload: unknown) {
    const channel = await this.ensureReady();
    const sent = channel.publish(
      getRabbitmqConfig().exchange,
      routingKey,
      Buffer.from(JSON.stringify(payload)),
      { persistent: true, contentType: 'application/json' },
    );
    if (!sent) {
      throw new ServiceUnavailableException('RabbitMQ 发布失败');
    }
  }

  /** 在绑定完成后另开一条通道，给订阅端消费，避免和发布共用通道。 */
  async openChannel() {
    await this.ensureReady();
    return this.connection!.createChannel();
  }

  private async ensureReady() {
    if (this.channel) {
      return this.channel;
    }

    const config = getRabbitmqConfig();
    const client = resolveAmqp(amqp);
    this.connection = await client.connect(config.url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange(config.exchange, config.exchangeType, {
      durable: true,
    });
    await this.channel.assertQueue(config.queues.published, {
      durable: true,
    });
    await this.channel.bindQueue(
      config.queues.published,
      config.exchange,
      config.routingKeys.published,
    );
    this.logger.log(
      `已绑定队列 queue=${config.queues.published} routingKey=${config.routingKeys.published}`,
    );
    return this.channel;
  }
}

function resolveAmqp(imported: unknown): AmqpClient {
  if (isAmqpClient(imported)) {
    return imported;
  }
  if (
    imported &&
    typeof imported === 'object' &&
    'default' in imported &&
    isAmqpClient(imported.default)
  ) {
    return imported.default;
  }
  throw new ServiceUnavailableException('无法加载 amqplib');
}

function isAmqpClient(value: unknown): value is AmqpClient {
  return (
    !!value &&
    typeof value === 'object' &&
    'connect' in value &&
    typeof value.connect === 'function'
  );
}
