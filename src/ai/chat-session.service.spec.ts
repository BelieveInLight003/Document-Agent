import { describe, expect, it, vi } from 'vitest';
vi.mock('./langsmith.js', () => ({
  startChatTrace: vi.fn(),
  hitTrace: vi.fn(),
}));
vi.mock('./chat-stream.js', () => ({ createAnswerStream: vi.fn() }));
import { ChatSessionService } from './chat-session.service.js';

function setup(locked: boolean) {
  const session = { id: 1n, userId: 2n };
  const repo = { findOne: vi.fn().mockResolvedValue(session) };
  const data = {
    query: vi.fn().mockResolvedValue(locked ? [{ token: 'lease' }] : []),
  };
  const service = new ChatSessionService(
    repo as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    data as never,
  );
  return { service, data, repo };
}
describe('session execution lock', () => {
  it('rejects a concurrent run without preparing or mutating memory', async () => {
    const { service, data } = setup(false);
    await expect(
      service.openStream('2', '1', 'hello', 5, { userId: '2', roles: [] }),
    ).rejects.toThrow('正在回答');
    expect(data.query).toHaveBeenCalledOnce();
  });
  it('releases the execution lock when preparation fails', async () => {
    const { service, data } = setup(true);
    await expect(
      service.openStream('2', '1', 'hello', 5, { userId: '2', roles: [] }),
    ).rejects.toThrow();
    expect(data.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM kh_chat_run'),
      ['1', expect.any(String)],
    );
  });
  it('checks ownership before acquiring a database connection', async () => {
    const { service, data, repo } = setup(true);
    repo.findOne.mockResolvedValue(null);
    await expect(
      service.openStream('3', '1', 'hello', 5, { userId: '3', roles: [] }),
    ).rejects.toThrow('会话不存在');
    expect(data.query).not.toHaveBeenCalled();
  });
  it('cancels a run when its database lease can no longer be renewed', async () => {
    vi.useFakeTimers();
    try {
      const { service, data } = setup(true);
      const onLost = vi.fn();
      const release = await service['acquireRun']('2', '1', onLost);
      data.query.mockResolvedValueOnce([]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(onLost).toHaveBeenCalledOnce();
      await release();
    } finally {
      vi.useRealTimers();
    }
  });
});
