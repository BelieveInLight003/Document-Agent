import { describe, expect, it } from 'vitest';
import type { CaseReport } from './eval-case.js';
import { runHealth } from './eval-report.js';

describe('evaluation execution reporting', () => {
  it('includes failed cases in completion and refusal accuracy denominators', () => {
    const reports = [
      {
        status: 'completed',
        refused: true,
        expectRefuse: true,
        durationMs: 100,
        calls: { model: 1, tool: 2 },
      },
      {
        status: 'failed',
        refused: false,
        expectRefuse: false,
        durationMs: 1_000,
        calls: { model: 2, tool: 3 },
      },
    ] as CaseReport[];
    expect(runHealth(reports)).toEqual({
      total: 2,
      completed: 1,
      failed: 1,
      completionRate: 0.5,
      refusalAccuracy: 0.5,
      p95DurationMs: 1_000,
      modelCalls: 3,
      toolCalls: 5,
    });
  });
  it('does not report perfect success for an empty evaluation', () => {
    expect(runHealth([])).toMatchObject({
      total: 0,
      completionRate: null,
      refusalAccuracy: null,
    });
  });
});
