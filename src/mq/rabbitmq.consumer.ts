import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import { RabbitmqPublisher } from './rabbitmq.publisher.js';

/** 业务处理函数。参数是 JSON 解析后的消息体，可以是同步或异步。 */
export type MessageHandler<T> = (message: T) => Promise<void> | void;

/**
 * 消费端。先收下三个队列的处理函数，等应用启动完成后再开始取消息。
 * 三个队列共用这一条通道。处理成功就确认；处理函数抛错才进入重试或失败队列。
 */
@Injectable()
export class RabbitmqConsumer
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RabbitmqConsumer.name);
  /** 取消息用的通道。和发布端的确认通道不是同一条。 */
  private channel?: Channel;
  /** 启动前登记的名单。每一项是「哪个队列，交给哪个函数」。 */
  private readonly subscriptions: {
    queue: string;
    handler: MessageHandler<unknown>;
  }[] = [];
  /** 三个队列是否都已经开始消费。 */
  private listening = false;
  /** 正在进行的那一次启动。并发调用时等待同一次 listen。 */
  private starting?: Promise<void>;
  /** 处理函数抛错后，最多再投递 3 次。第 4 次失败转入 .failed。 */
  private readonly maxRetry = 3;
  /** 每 5 秒检查一次。通道断了就重新订阅。 */
  private reconnectTimer?: ReturnType<typeof setInterval>;
  /** 应用正在关闭。为真时定时器不再重连。 */
  private stopped = false;

  constructor(private readonly publisher: RabbitmqPublisher) {}

  /** 只把处理函数记下来，此时还不连接，也不取消息。 */
  register<T>(queue: string, handler: MessageHandler<T>) {
    this.subscriptions.push({
      queue,
      handler: handler as MessageHandler<unknown>,
    });
  }

  /**
   * 所有模块的 onModuleInit 都结束后才执行。
   * 这时 PipelineManagerService 已经登记好三个处理函数，可以开始消费。
   */
  async onApplicationBootstrap() {
    this.reconnectTimer = setInterval(() => {
      if (!this.stopped)
        void this.ensureListening().catch((error) =>
          this.logger.warn(String(error)),
        );
    }, 5_000);
    this.reconnectTimer.unref();
    try {
      await this.ensureListening();
    } catch (error) {
      const detail = error instanceof Error ? error.message : '订阅失败';
      this.logger.warn(`RabbitMQ 订阅未启动：${detail}`);
    }
  }

  /** 还没在消费时再启动一次。已经在消费，或另一次启动还没结束，就直接等待。 */
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

  /** 停止重连，关掉消费通道。连接本身由发布端关闭。 */
  async onModuleDestroy() {
    this.stopped = true;
    clearInterval(this.reconnectTimer);
    await this.channel?.close().catch(() => undefined);
    this.channel = undefined;
    this.listening = false;
  }

  /** 打开一条消费通道，给三个已登记的队列各挂一个消费者。 */
  private async listen() {
    if (this.listening) {
      return;
    }
    if (this.subscriptions.length === 0) {
      this.logger.warn('还没有订阅处理函数，队列里的消息会先保留');
      return;
    }

    const channel = await this.publisher.openChannel();
    this.channel = channel;
    channel.on('error', (error) => this.logger.warn(error.message));
    // 通道断开后清掉状态，5 秒定时器会再次调用 ensureListening。
    channel.on('close', () => {
      if (this.channel === channel) {
        this.channel = undefined;
        this.listening = false;
      }
    });
    // 这条通道上最多同时有 2 条已取出但还没 ack 的消息，三个队列共用这个上限。
    await channel.prefetch(2);
    for (const subscription of this.subscriptions) {
      const handler = subscription.handler;
      await channel.consume(subscription.queue, (message) => {
        void this.handleMessage(
          channel,
          message,
          handler,
          subscription.queue,
        ).catch(async (error) => {
          this.logger.error(String(error));
          await channel.close().catch(() => undefined);
        });
      });
      this.logger.log(`已订阅队列 queue=${subscription.queue}`);
    }
    this.listening = true;
  }

  /**
   * 处理一条消息。
   * 成功：调用业务函数，然后 ack，消息从队列删除。
   * 业务函数抛错：不 ack，转去重试或失败队列。
   * message 为空表示消费者被取消，直接返回。
   */
  private async handleMessage(
    channel: Channel,
    message: ConsumeMessage | null,
    handler: MessageHandler<unknown>,
    queue: string,
  ) {
    if (!message) {
      return;
    }
    try {
      const payload = JSON.parse(message.content.toString()) as unknown;
      await handler(payload);
      channel.ack(message);
    } catch (error) {
      const routingKey = message.fields.routingKey;
      const detail = describeError(error);
      this.logger.error(`消息处理失败 routingKey=${routingKey} ${detail}`);
      await this.retryOrDrop(channel, message, queue);
    }
  }

  /**
   * 先把原消息复制到重试队列或失败队列，确认写成功后再 ack 原消息。
   * 复制失败时这里会抛错，原消息不 ack，通道关闭后还可以重新投递。
   */
  private async retryOrDrop(
    channel: Channel,
    message: ConsumeMessage,
    queue: string,
  ) {
    const retry = Number(message.properties.headers?.['x-retry'] ?? 0);
    if (retry >= this.maxRetry) {
      await this.publisher.publishRaw('', `${queue}.failed`, message.content, {
        headers: message.properties.headers,
      });
      channel.ack(message);
      return;
    }

    // 第 1、2、3 次失败分别等 1 秒、2 秒、4 秒。到期后死信回到原来的业务队列。
    await this.publisher.publishRaw('', `${queue}.retry`, message.content, {
      persistent: true,
      contentType: 'application/json',
      headers: { ...message.properties.headers, 'x-retry': retry + 1 },
      expiration: String(1_000 * 2 ** retry),
    });
    channel.ack(message);
  }
}

/** 把异常整理成一行日志。Elasticsearch 的响应体会放在 body 里。 */
function describeError(error: unknown) {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause =
    error.cause instanceof Error ? ` cause=${error.cause.message}` : '';
  const body = (error as { meta?: { body?: unknown } }).meta?.body;
  const response = body == null ? '' : ` body=${JSON.stringify(body)}`;
  return `${error.name}: ${error.message}${cause}${response}`;
}
