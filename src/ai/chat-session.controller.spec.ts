import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
vi.mock('./chat-session.service.js', () => ({ ChatSessionService: class {} }));
import { ChatSessionController } from './chat-session.controller.js';

describe('disconnect during stream preparation', () => {
  it('registers cancellation before waiting for openStream', async () => {
    let signal!: AbortSignal;
    const service = {
      openStream: vi.fn(
        (
          _user,
          _id,
          _question,
          _limit,
          _viewer,
          requestSignal: AbortSignal,
        ) => {
          signal = requestSignal;
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          });
        },
      ),
    };
    const response = Object.assign(new EventEmitter(), {
      writableFinished: false,
      destroyed: false,
      headersSent: false,
      status: vi.fn(),
      json: vi.fn(),
    });
    const controller = new ChatSessionController(service as never);
    const pending = controller.stream(
      { user: { id: '1', roles: [] } } as never,
      '2',
      { question: 'question' },
      response as never,
    );
    response.destroyed = true;
    response.emit('close');
    await pending;
    expect(signal.aborted).toBe(true);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.listenerCount('close')).toBe(0);
  });
});
