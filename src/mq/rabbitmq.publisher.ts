import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import amqp, {
  type ChannelModel,
  type ConfirmChannel,
  type Options,
} from 'amqplib';
import { getRabbitmqConfig } from './rabbitmq.config.js';

type AmqpClient = {
  connect: (
    url: string,
    options?: { timeout: number },
  ) => Promise<ChannelModel>;
};

/**
 * 发布端。负责三件事：连上 RabbitMQ、把交换机和队列建好、把消息发出去并等待确认。
 * 消费不在这里做。RabbitmqConsumer 会借用本类另开的通道去取消息。
 */
@Injectable()
export class RabbitmqPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqPublisher.name);
  /** 一条 TCP 连接。断线后会清空，下次发送时重新连接。 */
  private connection?: ChannelModel;
  /** 专门用来发布的通道。ConfirmChannel 会在 broker 收下消息后回调。 */
  private channel?: ConfirmChannel;
  /** 正在进行的那一次连接。并发发布时大家等待同一个 Promise，避免连出多条连接。 */
  private connecting?: Promise<ConfirmChannel>;

  /** 应用启动时先试一次。RabbitMQ 没起来只记警告，不阻止整个应用启动。 */
  async onModuleInit() {
    try {
      await this.ensureReady();
    } catch (error) {
      const detail = error instanceof Error ? error.message : '连接失败';
      this.logger.warn(`RabbitMQ 暂未连接：${detail}`);
    }
  }

  /** 应用关闭时先关通道，再关连接。关失败也忽略，避免拖住退出。 */
  async onModuleDestroy() {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
    this.channel = undefined;
    this.connection = undefined;
  }

  /**
   * 业务侧使用的发送入口。
   * payload 会先变成 JSON 字符串，再交给 publishRaw 发到配置里的交换机。
   */

  async publish(routingKey: string, payload: unknown) {
    return this.publishRaw(
      getRabbitmqConfig().exchange,
      routingKey,
      Buffer.from(JSON.stringify(payload)),
    );
  }

  /**
   * 真正发送的地方。消费端重试时也会调用它，所以交换机、路由键和内容都由调用方传入。
   * 返回的 Promise 要等 broker 确认，不能在 publish 一调用就当成功。
   */
  async publishRaw(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: Options.Publish = {},
  ) {
    const channel = await this.ensureReady();
    await new Promise<void>((resolve, reject) => {
      // 30 秒内没有确认就失败，并关掉这条通道，下次发送会重新连接。
      const timer = setTimeout(() => {
        reject(new Error('RabbitMQ publication confirmation timed out'));
        void channel.close().catch(() => undefined);
      }, 30_000);
      timer.unref();
      try {
        channel.publish(
          exchange,
          routingKey,
          content,
          // persistent 表示消息要落盘，RabbitMQ 重启后还在。
          { persistent: true, contentType: 'application/json', ...options },
          (error) => {
            clearTimeout(timer);
            if (error) reject(error);
            else resolve();
          },
        );
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /** 给消费端另开一条普通通道。发布和消费分开，避免互相阻塞。 */
  async openChannel() {
    await this.ensureReady();
    return this.connection!.createChannel();
  }

  /**
   * 拿到可用的发布通道。
   * 已经连上就直接返回；正在连就等待同一次连接；否则开始一次新连接。
   */
  private async ensureReady() {
    if (this.channel) {
      return this.channel;
    }

    if (!this.connecting) {
      this.connecting = this.connect().finally(() => {
        this.connecting = undefined;
      });
    }
    return this.connecting;
  }

  /** 建立连接，声明交换机、业务队列、重试队列和失败队列，并把业务队列绑到路由键上。 */
  private async connect() {
    const previous = this.connection;
    this.connection = undefined;
    if (previous) await previous.close().catch(() => undefined);
    const config = getRabbitmqConfig();
    const client = resolveAmqp(amqp);
    const connection = await client.connect(config.url, { timeout: 5_000 });
    this.connection = connection;
    connection.on('error', (error) => this.logger.warn(error.message));
    // 只清掉当前这条连接。重连期间如果又有新连接，不能把新连接误清掉。
    connection.on('close', () => {
      if (this.connection === connection) {
        this.connection = undefined;
        this.channel = undefined;
      }
    });
    const channel = await connection.createConfirmChannel();
    channel.on('error', (error) => this.logger.warn(error.message));
    channel.on('close', () => {
      if (this.channel === channel) this.channel = undefined;
    });
    try {
      // durable 表示交换机和队列本身要持久化，重启后声明还在。
      await channel.assertExchange(config.exchange, config.exchangeType, {
        durable: true,
      });
      const bindings = [
        {
          queue: config.queues.published,
          routingKey: config.routingKeys.published,
        },
        {
          queue: config.queues.keyword,
          routingKey: config.routingKeys.keyword,
        },
        {
          queue: config.queues.graph,
          routingKey: config.routingKeys.graph,
        },
      ];
      for (const binding of bindings) {
        await channel.assertQueue(binding.queue, { durable: true });
        // 超过重试次数的消息会放到同名 .failed 队列，留着排查。
        await channel.assertQueue(`${binding.queue}.failed`, { durable: true });
        // .retry 队列不直接消费。消息到期后，按原路由键死信回交换机，重新进入业务队列。
        await channel.assertQueue(`${binding.queue}.retry`, {
          durable: true,
          arguments: {
            'x-dead-letter-exchange': config.exchange,
            'x-dead-letter-routing-key': binding.routingKey,
          },
        });
        await channel.bindQueue(
          binding.queue,
          config.exchange,
          binding.routingKey,
        );
        this.logger.log(
          `已绑定队列 queue=${binding.queue} routingKey=${binding.routingKey}`,
        );
      }
      this.channel = channel;
      return channel;
    } catch (error) {
      await connection.close().catch(() => undefined);
      throw error;
    }
  }
}

/** 兼容 amqplib 的两种导出：直接导出 connect，或者包在 default 里。 */
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
