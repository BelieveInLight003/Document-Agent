import { describe, expect, it, vi } from 'vitest';
import { RabbitmqConsumer } from '../rabbitmq.consumer.js';

function setup(retry = 0) {
  const publisher = { publishRaw: vi.fn().mockResolvedValue(undefined) };
  const consumer = new RabbitmqConsumer(publisher as never);
  const channel = { ack: vi.fn(), nack: vi.fn() };
  const message = {
    content: Buffer.from('{"documentId":"123"}'),
    fields: { routingKey: 'document.published' },
    properties: { headers: { 'x-retry': retry } },
  };
  const handle = () =>
    consumer['handleMessage'](
      channel as never,
      message as never,
      async () => {
        throw new Error('failed');
      },
      'documents',
    );
  return { publisher, channel, handle };
}
describe('message recovery', () => {
  it('acks a retry only after the replacement message has been confirmed', async () => {
    const { publisher, channel, handle } = setup();
    let confirm!: () => void;
    publisher.publishRaw.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          confirm = resolve;
        }),
    );
    const pending = handle();
    await vi.waitFor(() => expect(publisher.publishRaw).toHaveBeenCalled());
    expect(channel.ack).not.toHaveBeenCalled();
    confirm();
    await pending;
    expect(channel.ack).toHaveBeenCalledOnce();
    expect(publisher.publishRaw).toHaveBeenCalledWith(
      '',
      'documents.retry',
      expect.any(Buffer),
      expect.objectContaining({
        expiration: '1000',
        headers: { 'x-retry': 1 },
      }),
    );
  });
  it('keeps exhausted messages in a durable failure queue', async () => {
    const { publisher, channel, handle } = setup(3);
    await handle();
    expect(publisher.publishRaw).toHaveBeenCalledWith(
      '',
      'documents.failed',
      expect.any(Buffer),
      expect.objectContaining({ headers: { 'x-retry': 3 } }),
    );
    expect(channel.ack).toHaveBeenCalledOnce();
    expect(channel.nack).not.toHaveBeenCalled();
  });
  it('does not ack the original when replacement publication fails', async () => {
    const { publisher, channel, handle } = setup();
    publisher.publishRaw.mockRejectedValue(new Error('broker offline'));
    await expect(handle()).rejects.toThrow('broker offline');
    expect(channel.ack).not.toHaveBeenCalled();
  });
});
