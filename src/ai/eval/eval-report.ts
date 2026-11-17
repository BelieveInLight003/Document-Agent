import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INTENT_LABEL } from '../agent-route.js';
import type { CaseReport, MetricScore } from './eval-case.js';

/**
 * 把每一题和八项平均分打到终端，并写一份 JSON。
 * JSON 在 eval-reports/，已加入 gitignore，里面有回答原文，不要提交。
 */

const GUIDE = [
  '检索四项只看原问题的第一轮文档检索，前 5 条，发生在切题评估之前。',
  'Recall 看找回的必需切片比例，全证据命中要求全部找回；Precision 看前 5 条噪声，MRR 看第一条对的排名，Hit 看是否命中。',
  '生成四项看最终回答：忠实是不是只根据资料，相关是不是答这问，完整盖住多少要点，送进回答的必需切片用了多少。',
  '跳过表示这题按规则不评。未评表示裁判没有返回结果，不记入平均分。',
].join('\n');

export function printGuide(total: number) {
  console.log(
    `开始评测 ${total} 题。每题会真实检索并调用模型，不写会话、Redis 和 Mem0。`,
  );
  console.log(GUIDE);
  console.log('');
}

export function printCase(report: CaseReport, index: number, total: number) {
  const intent = report.actualIntent
    ? INTENT_LABEL[report.actualIntent]
    : '没有跑完';
  const expected = INTENT_LABEL[report.expectedIntent];
  const intentText = report.intentMatched
    ? `意图 ${intent}，与标注一致`
    : `意图 ${intent}，标注是 ${expected}`;
  console.log(`${index}/${total}  ${report.question}  [${report.id}]`);
  console.log(`  ${intentText}。联网：${report.usedWeb ? '有' : '没有'}。`);
  if (report.retrieval) {
    const row = report.retrieval;
    console.log(
      `  检索  Recall ${num(row.recall)}  Precision ${num(row.precision)}  MRR ${num(row.mrr)}  Hit ${num(row.hit)}  （对上 ${row.matched}/${row.required} 条）`,
    );
  } else {
    console.log(`  检索  ${report.retrievalNote || '不评'}`);
  }
  if (report.handed) {
    console.log(
      `  送进回答的必需切片  ${report.handed.matched}/${report.handed.required}`,
    );
  }
  console.log(
    `  生成  忠实 ${show(report.faithfulness)}  相关 ${show(report.relevancy)}  完整 ${show(report.completeness)}  利用 ${show(report.utilization)}`,
  );
  if (report.error) console.log(`  失败  ${report.error}`);
  const preview = [...report.answer.replace(/\s+/g, ' ')].slice(0, 80).join('');
  if (preview) console.log(`  回答  ${preview}`);
  console.log('');
}

export function printSummary(reports: CaseReport[]) {
  const retrieval = reports.flatMap((item) =>
    item.retrieval ? [item.retrieval] : [],
  );
  console.log('汇总');
  console.log(
    `  题量 ${reports.length}。其中评了检索的 ${retrieval.length} 题。`,
  );
  console.log(`  Recall@5     ${avg(retrieval.map((item) => item.recall))}`);
  console.log(`  Precision@5  ${avg(retrieval.map((item) => item.precision))}`);
  console.log(`  MRR          ${avg(retrieval.map((item) => item.mrr))}`);
  console.log(`  Hit@5        ${avg(retrieval.map((item) => item.hit))}`);
  console.log(
    `  全证据命中   ${avg(retrieval.map((item) => item.allEvidenceHit))}`,
  );
  console.log(`  执行情况     ${JSON.stringify(runHealth(reports))}`);
  console.log(
    `  忠实度       ${avg(values(reports, 'faithfulness'))}    ${countState(reports, 'faithfulness')}`,
  );
  console.log(
    `  答案相关性   ${avg(values(reports, 'relevancy'))}    ${countState(reports, 'relevancy')}`,
  );
  console.log(
    `  答案完整性   ${avg(values(reports, 'completeness'))}    ${countState(reports, 'completeness')}`,
  );
  console.log(
    `  上下文利用率 ${avg(values(reports, 'utilization'))}    ${countState(reports, 'utilization')}`,
  );
  const intents = reports.filter((item) => item.intentMatched != null);
  const intentHits = intents.filter((item) => item.intentMatched).length;
  console.log(
    `  意图命中     ${intents.length === 0 ? '—' : `${intentHits}/${intents.length}`}  （不属于图里的八项）`,
  );
  printList(
    '召回为 0',
    reports
      .filter((item) => item.retrieval?.recall === 0)
      .map((item) => item.question),
  );
  printList(
    '忠实度为 0',
    reports
      .filter((item) => item.faithfulness.value === 0)
      .map((item) => item.question),
  );
  printList(
    '标注没对上',
    reports
      .filter((item) => item.retrievalNote.includes('没对上'))
      .map((item) => `${item.id} ${item.retrievalNote}`),
  );
  printList(
    '没正常答完',
    reports
      .filter(
        (item) =>
          item.error || item.faithfulness.reason.includes('没有正常完成'),
      )
      .map((item) => item.question),
  );
}

export function writeReport(reports: CaseReport[]) {
  const directory = resolve(process.cwd(), 'eval-reports');
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, `agent-eval-${stamp()}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        guide: GUIDE,
        createdAt: new Date().toISOString(),
        summary: {
          execution: runHealth(reports),
          allEvidenceHit: mean(
            reports.flatMap((item) =>
              item.retrieval ? [item.retrieval.allEvidenceHit] : [],
            ),
          ),
          sampleCounts: Object.fromEntries(
            (
              [
                'faithfulness',
                'relevancy',
                'completeness',
                'utilization',
              ] as const
            ).map((key) => [
              key,
              {
                scored: values(reports, key).length,
                skipped: reports.filter((item) => item[key].state === 'skipped')
                  .length,
                unevaluated: reports.filter(
                  (item) => item[key].state === 'unevaluated',
                ).length,
              },
            ]),
          ),
          recall: mean(
            reports.flatMap((item) =>
              item.retrieval ? [item.retrieval.recall] : [],
            ),
          ),
          precision: mean(
            reports.flatMap((item) =>
              item.retrieval ? [item.retrieval.precision] : [],
            ),
          ),
          mrr: mean(
            reports.flatMap((item) =>
              item.retrieval ? [item.retrieval.mrr] : [],
            ),
          ),
          hit: mean(
            reports.flatMap((item) =>
              item.retrieval ? [item.retrieval.hit] : [],
            ),
          ),
          faithfulness: mean(values(reports, 'faithfulness')),
          relevancy: mean(values(reports, 'relevancy')),
          completeness: mean(values(reports, 'completeness')),
          utilization: mean(values(reports, 'utilization')),
        },
        cases: reports,
      },
      null,
      2,
    ),
  );
  console.log(`\n详细结果已写入 ${file}`);
}

export function runHealth(reports: CaseReport[]) {
  const total = reports.length;
  const completed = reports.filter(
    (item) => item.status === 'completed',
  ).length;
  const durations = reports
    .map((item) => item.durationMs)
    .sort((a, b) => a - b);
  return {
    total,
    completed,
    failed: total - completed,
    completionRate: total ? completed / total : null,
    refusalAccuracy: total
      ? reports.filter(
          (item) =>
            item.status === 'completed' && item.refused === item.expectRefuse,
        ).length / total
      : null,
    p95DurationMs: durations.length
      ? durations[Math.ceil(durations.length * 0.95) - 1]
      : null,
    modelCalls: reports.reduce((sum, item) => sum + item.calls.model, 0),
    toolCalls: reports.reduce((sum, item) => sum + item.calls.tool, 0),
  };
}

function values(
  reports: CaseReport[],
  key: 'faithfulness' | 'relevancy' | 'completeness' | 'utilization',
) {
  return reports.flatMap((item) => {
    const score = item[key];
    return score.state === 'scored' && score.value != null ? [score.value] : [];
  });
}

function countState(
  reports: CaseReport[],
  key: 'faithfulness' | 'relevancy' | 'completeness' | 'utilization',
) {
  const skippedCount = reports.filter(
    (item) => item[key].state === 'skipped',
  ).length;
  const missed = reports.filter(
    (item) => item[key].state === 'unevaluated',
  ).length;
  return `已评 ${values(reports, key).length}，跳过 ${skippedCount}，未评 ${missed}`;
}

function show(score: MetricScore) {
  if (score.state === 'skipped') return '跳过';
  if (score.state === 'unevaluated' || score.value == null) return '未评';
  return num(score.value);
}

function avg(numbers: number[]) {
  const value = mean(numbers);
  if (value == null) return '—';
  return `${num(value)}（${Math.round(value * 100)}%）`;
}

function mean(numbers: number[]) {
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function num(value: number) {
  return value.toFixed(2);
}

function printList(title: string, lines: string[]) {
  if (lines.length === 0) return;
  console.log(`  ${title}`);
  for (const line of lines) console.log(`    - ${line}`);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
