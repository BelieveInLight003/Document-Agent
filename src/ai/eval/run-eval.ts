import '../langsmith.js';
import { NestFactory } from '@nestjs/core';
import type { AgentIntent } from '../agent-route.js';
import { AiService } from '../ai.service.js';
import { GraphService } from '../../graph/graph.service.js';
import type { CaseReport } from './eval-case.js';
import { EVAL_DATASET } from './eval-dataset.js';
import { EvalModule } from './eval.module.js';
import { printCase, printGuide, printSummary, writeReport } from './eval-report.js';
import { runEvalCase } from './eval-run-case.js';

/**
 * 离线评测入口。在 backend 目录执行：
 *
 *   pnpm eval:agent
 *   pnpm eval:agent -- --limit 1
 *   pnpm eval:agent -- --id expense-approver
 *   pnpm eval:agent -- --intent knowledge
 *
 * 先编译再跑。题目在 eval-dataset.ts，检索公式在 eval-metrics.ts，
 * 生成裁判在 eval-judge.ts，单题过程在 eval-run-case.ts。
 */

const INTENTS: AgentIntent[] = ['chat', 'preference', 'knowledge', 'web', 'knowledge_then_web'];

async function main() {
  const args = readArgs(process.argv.slice(2));
  const cases = pickCases(args);
  if (cases.length === 0) {
    console.log('没有符合条件的题目。');
    return;
  }
  printGuide(cases.length);
  const app = await NestFactory.createApplicationContext(EvalModule, {
    logger: ['error', 'warn'],
  });
  try {
    const aiService = app.get(AiService);
    const graphService = app.get(GraphService);
    const reports: CaseReport[] = [];
    for (let index = 0; index < cases.length; index += 1) {
      const report = await runEvalCase(cases[index], aiService, graphService);
      reports.push(report);
      printCase(report, index + 1, cases.length);
    }
    printSummary(reports);
    writeReport(reports);
  } finally {
    await app.close();
  }
}

function pickCases(args: { limit?: number; id?: string; intent?: AgentIntent }) {
  let cases = EVAL_DATASET;
  if (args.id) cases = cases.filter((item) => item.id === args.id);
  if (args.intent) cases = cases.filter((item) => item.intent === args.intent);
  if (args.limit != null) cases = cases.slice(0, args.limit);
  return cases;
}

function readArgs(argv: string[]) {
  const limitText = flag(argv, '--limit');
  const intentText = flag(argv, '--intent');
  let limit: number | undefined;
  if (limitText != null) {
    limit = Number(limitText);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('--limit 要是正整数');
    }
  }
  let intent: AgentIntent | undefined;
  if (intentText != null) {
    if (!INTENTS.includes(intentText as AgentIntent)) {
      throw new Error(`--intent 只能是 ${INTENTS.join('、')}`);
    }
    intent = intentText as AgentIntent;
  }
  return { limit, id: flag(argv, '--id'), intent };
}

function flag(argv: string[], name: string) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  return argv[index + 1];
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`评测没有跑起来：${message}`);
    process.exit(1);
  });
