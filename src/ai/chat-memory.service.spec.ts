import { describe, expect, it, vi } from 'vitest';
vi.mock('./langsmith.js', () => ({ tracedGenerateText: vi.fn() }));
import { ChatMemoryService } from './chat-memory.service.js';

describe('memory cache outage', () => {
  it('restores database messages even when Redis reads and writes fail', async () => {
    const redis = {
      get: vi.fn().mockRejectedValue(new Error('offline')),
      set: vi.fn().mockRejectedValue(new Error('offline')),
    };
    const messages = {
      find: vi.fn().mockResolvedValue([
        { role: 'assistant', content: 'The topic is expenses.' },
        { role: 'user', content: 'expenses' },
      ]),
    };
    const service = new ChatMemoryService(redis as never, messages as never);
    const result = await service.prepare(1n, 'A complete question');
    expect(result.memoryText).toContain('expenses');
    expect(result.snapshot.turns).toHaveLength(2);
    expect(redis.set).toHaveBeenCalled();
  });
  it('returns an existing cached snapshot even if TTL refresh fails', async () => {
    const redis = {
      get: vi.fn().mockResolvedValue({ summary: 'summary', turns: [] }),
      set: vi.fn().mockRejectedValue(new Error('offline')),
    };
    const messages = { find: vi.fn() };
    const service = new ChatMemoryService(redis as never, messages as never);
    expect(
      (await service.prepare(1n, 'A complete question')).memoryText,
    ).toContain('summary');
    expect(messages.find).not.toHaveBeenCalled();
  });
});
