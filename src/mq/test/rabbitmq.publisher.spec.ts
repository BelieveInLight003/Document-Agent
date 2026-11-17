import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('amqplib', () => ({ default: { connect: mocks.connect } }));
import { RabbitmqPublisher } from '../rabbitmq.publisher.js';

describe('broker publication confirmation', () => {
  beforeEach(() => vi.resetAllMocks());
  it('waits for broker confirmation instead of treating socket backpressure as failure', async () => {
    let confirm!: (error?: Error) => void;
    const channel = Object.assign(new EventEmitter(), {
      assertExchange: vi.fn(),
      assertQueue: vi.fn(),
      bindQueue: vi.fn(),
      publish: vi.fn((_exchange, _key, _body, _options, callback) => {
        confirm = callback;
        return false;
      }),
      close: vi.fn(),
    });
    const connection = Object.assign(new EventEmitter(), {
      createConfirmChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn(),
    });
    mocks.connect.mockResolvedValue(connection);
    const publisher = new RabbitmqPublisher();
    await publisher.onModuleInit();
    const settled = vi.fn();
    const pending = publisher.publish('document.published', {}).then(settled);
    await vi.waitFor(() => expect(channel.publish).toHaveBeenCalled());
    expect(settled).not.toHaveBeenCalled();
    confirm();
    await pending;
    expect(settled).toHaveBeenCalledOnce();
  });
  it('propagates a broker nack to the durable outbox dispatcher', async () => {
    const channel = Object.assign(new EventEmitter(), {
      assertExchange: vi.fn(),
      assertQueue: vi.fn(),
      bindQueue: vi.fn(),
      publish: vi.fn((_exchange, _key, _body, _options, callback) => {
        callback(new Error('broker rejected publication'));
        return true;
      }),
      close: vi.fn(),
    });
    mocks.connect.mockResolvedValue(
      Object.assign(new EventEmitter(), {
        createConfirmChannel: vi.fn().mockResolvedValue(channel),
        close: vi.fn(),
      }),
    );
    const publisher = new RabbitmqPublisher();
    await expect(publisher.publish('document.published', {})).rejects.toThrow(
      'broker rejected',
    );
  });
});
