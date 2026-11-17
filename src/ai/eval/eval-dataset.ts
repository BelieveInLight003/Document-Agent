import type { EvalCase } from './eval-case.js';

/**
 * 评测题。知识库题的切片来自当前索引里这三篇已发布文档：
 * - 01-travel-expense-policy（差旅与费用报销管理办法）
 * - 02-production-release-sop（生产环境变更发布流程）
 * - 新员工入职指南
 *
 * 重新发布文档后，chunkId 可能变化。程序会用 mustContain 在同一篇文档里再找一次。
 * 文档被删掉、或正文里不再有这个词，这题的检索分数会空着，并在结果里标成「标注没对上」。
 *
 * 下面这些题还没有覆盖，需要以后自己加：
 * - Redis 中真实多轮指代的读写。当前上下文题使用注入的固定记忆。
 * - Mem0 的真实跨会话记忆。偏好题使用固定记忆或空记忆，不写 Mem0。
 * - 普通用户看不到未公开文档。评测用管理员阅读已发布文档，权限过滤不在分数里。
 * - 图谱单独的命中。图里的四项只比文档切片。
 * - 天气题只要求提到地点和天气，不要求某一个温度，因为预报每天都在变。
 */

const EXPENSE = '374075750573150208';
const APPROVAL = '374076090018172928';
const STANDARD = '374076090018172929';
const SUBMIT = '374076090018172930';
const SOP = '374075813714202624';
const SOP_ROLE = '374076081835085824';
const SOP_WINDOW = '374076081835085825';
const SOP_RELEASE = '374076081835085826';
const SOP_AFTER = '374076081835085827';
const ONBOARD_DOC = '373727058687168512';
const ONBOARD = '373727058972381184';

export const EVAL_DATASET: EvalCase[] = [
  {
    id: 'remembered-preference',
    question: '我平时喜欢吃什么？',
    intent: 'preference',
    expectRefuse: false,
    memory: '',
    longTerm: '长期信息：用户偏好清淡饮食，喜欢面条。',
    gold: [],
    keyPoints: ['喜欢面条', '偏好清淡饮食'],
    note: '有长期记忆时必须能回答，不能沿用空记忆拒答。',
  },
  {
    id: 'followup-context',
    question: '那报销超过 5000 元呢，谁加签？',
    intent: 'knowledge',
    expectRefuse: false,
    memory: '最近对话：用户正在咨询出差报销审批流程。',
    gold: [{ chunkId: APPROVAL, documentId: EXPENSE, mustContain: '5000' }],
    keyPoints: ['部门总监加签'],
    note: '显式提供上文，检验带上下文的路由和生成。',
  },
  {
    id: 'expense-approver',
    question: '报销需要谁审批？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: APPROVAL, documentId: EXPENSE, mustContain: '5000' }],
    keyPoints: [
      '直属 Leader 审批出差申请',
      '超过 5000 元需要部门总监加签',
      '财务审核员负责发票和金额复核',
    ],
    note: '审批链在差旅办法的出差审批流程里。',
  },
  {
    id: 'expense-unapproved',
    question: '未经审批的出差费用能报销吗？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: APPROVAL, documentId: EXPENSE, mustContain: '5000' }],
    keyPoints: ['未经审批产生的费用原则上不予报销'],
    note: '答案在总则，和审批链是同一段切片。',
  },
  {
    id: 'expense-train-m2',
    question: 'M2 及以下坐高铁，座位标准是什么？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: STANDARD, documentId: EXPENSE, mustContain: '600' }],
    keyPoints: ['M2 及以下高铁或动车坐二等座'],
    note: '交通标准表。M3 及以上才是一等座。',
  },
  {
    id: 'expense-city-m3',
    question: 'M3 及以上市内交通每天上限是多少？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: STANDARD, documentId: EXPENSE, mustContain: '600' }],
    keyPoints: ['市内交通实报实销，上限 300 元/天'],
    note: '不要答成 M2 的 200 元。',
  },
  {
    id: 'expense-hotel-beijing',
    question: '北京住宿费上限是多少？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: STANDARD, documentId: EXPENSE, mustContain: '600' }],
    keyPoints: ['北京住宿上限 600 元/晚，含税'],
    note: '上海 550、成都 450，不要混在一起。',
  },
  {
    id: 'expense-hotel-shanghai',
    question: '上海住宿费上限是多少？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: STANDARD, documentId: EXPENSE, mustContain: '600' }],
    keyPoints: ['上海住宿上限 550 元/晚'],
    note: '和北京、成都的上限不同。',
  },
  {
    id: 'expense-hotel-chengdu',
    question: '成都住宿费上限是多少？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: STANDARD, documentId: EXPENSE, mustContain: '600' }],
    keyPoints: ['成都住宿上限 450 元/晚'],
    note: '三地上限里最低的一档。',
  },
  {
    id: 'expense-personal-ticket',
    question: '用个人渠道订、没有在 OA 备案的机票能报销吗？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: STANDARD, documentId: EXPENSE, mustContain: '600' }],
    keyPoints: ['未在 OA 备案的个人渠道机票不予报销'],
    note: '制度写明和个人渠道预订冲突。',
  },
  {
    id: 'expense-meal',
    question: '出差餐饮补贴怎么算？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: SUBMIT, documentId: EXPENSE, mustContain: '8801' }],
    keyPoints: [
      '出差餐饮按 100 元/天包干，不需要发票',
      '当日返回不计补贴',
      '客户招待不能和差旅补贴一起领',
    ],
    note: '补贴规则和报销提交流程在同一段切片。',
  },
  {
    id: 'expense-deadline',
    question: '回到公司后几天内要提交报销？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: SUBMIT, documentId: EXPENSE, mustContain: '8801' }],
    keyPoints: ['回到办公地后 10 个工作日内提交', '在 OA 系统发起报销单'],
    note: '发票丢失的 30 天补报不是这题的主答案。',
  },
  {
    id: 'expense-invoice',
    question: '报销发票抬头要写什么？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: SUBMIT, documentId: EXPENSE, mustContain: '8801' }],
    keyPoints: ['发票抬头须为某某科技有限公司'],
    note: '抬头是固定公司名。',
  },
  {
    id: 'expense-pay',
    question: '财务审核通过后多久打款？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: SUBMIT, documentId: EXPENSE, mustContain: '8801' }],
    keyPoints: ['审核通过后 5 个工作日内打款到工资卡'],
    note: '不要答成提交期限的 10 个工作日。',
  },
  {
    id: 'expense-contact',
    question: '报销进度该问谁？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: SUBMIT, documentId: EXPENSE, mustContain: '8801' }],
    keyPoints: ['联系张敏', '分机 8801'],
    note: '财务共享中心的联系人。',
  },
  {
    id: 'expense-audit',
    question: '审计部怎么抽查报销？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: SUBMIT, documentId: EXPENSE, mustContain: '8801' }],
    keyPoints: ['每季度抽查 10% 的报销单'],
    note: '重大违规线索移交合规部，抽查比例是 10%。',
  },
  {
    id: 'expense-two-chunks',
    question: '报销超过 5000 元要谁加签？财务审核通过后几天打款？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [
      { chunkId: APPROVAL, documentId: EXPENSE, mustContain: '5000' },
      { chunkId: SUBMIT, documentId: EXPENSE, mustContain: '8801' },
    ],
    keyPoints: ['超过 5000 元需要部门总监加签', '审核通过后 5 个工作日内打款'],
    note: '两段切片都得出现在前 5 条，Recall 才是 1。只找回一段时 Hit 仍是 1。',
  },
  {
    id: 'onboard-first-day',
    question: '入职当天要办哪些手续？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [
      { chunkId: ONBOARD, documentId: ONBOARD_DOC, mustContain: 'GitLab' },
    ],
    keyPoints: ['领取工牌', '开通 GitLab', '开通企业邮箱'],
    note: '入职指南目前只有这一段正文。',
  },
  {
    id: 'onboard-owner',
    question: '知识库由哪个部门负责？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [
      { chunkId: ONBOARD, documentId: ONBOARD_DOC, mustContain: 'GitLab' },
    ],
    keyPoints: ['研发中心负责知识库'],
    note: '不要答成发布流程里的平台工程部。那是另一篇文档。',
  },
  {
    id: 'sop-window',
    question: '常规生产发布窗口是什么时候？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: SOP_WINDOW, documentId: SOP, mustContain: '22:00' }],
    keyPoints: ['每周二和周四', '22:00 到 24:00'],
    note: '紧急窗口是 7×24，不是常规窗口。',
  },
  {
    id: 'sop-reject',
    question: '预发验证失败，谁可以驳回发布？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: SOP_WINDOW, documentId: SOP, mustContain: '22:00' }],
    keyPoints: ['SRE 值班工程师可以驳回发布'],
    note: '驳回后要重新走变更评审。',
  },
  {
    id: 'sop-emergency',
    question: '线上故障的紧急发布要谁审批？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [
      { chunkId: SOP_RELEASE, documentId: SOP, mustContain: '2026-01-20' },
    ],
    keyPoints: ['紧急窗口需要总监审批'],
    note: '封网期也只允许紧急变更。',
  },
  {
    id: 'sop-freeze',
    question: '2026 年一季度封网从哪天到哪天？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [
      { chunkId: SOP_RELEASE, documentId: SOP, mustContain: '2026-01-20' },
    ],
    keyPoints: ['2026-01-20 至 2026-01-27'],
    note: '封网期内常规发布窗口关闭。',
  },
  {
    id: 'sop-gray',
    question: '灰度发布默认放多少流量，观察多久？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [
      { chunkId: SOP_RELEASE, documentId: SOP, mustContain: '2026-01-20' },
    ],
    keyPoints: ['默认灰度 10% 的 Pod', '观察 15 分钟无异常后全量'],
    note: '知识库和订单中心使用 Kubernetes 滚动发布。',
  },
  {
    id: 'sop-rollback',
    question: '什么情况下要立刻回滚？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [
      { chunkId: SOP_RELEASE, documentId: SOP, mustContain: '2026-01-20' },
    ],
    keyPoints: [
      '5 分钟内错误率上升超过 2% 要立刻回滚',
      '使用 Helm 回退上一版本',
    ],
    note: '回滚后还要通知产品经理是否对外公告。',
  },
  {
    id: 'sop-check-time',
    question: '发布前检查最晚什么时候完成？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: SOP_ROLE, documentId: SOP, mustContain: '李明' }],
    keyPoints: ['变更日前一天 18:00 前完成'],
    note: '检查项包括代码合并、预发、配置、依赖和通知。',
  },
  {
    id: 'sop-approver',
    question: '知识库发布窗口的默认审批人是谁？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: SOP_ROLE, documentId: SOP, mustContain: '李明' }],
    keyPoints: ['李明是 2026 年一季度知识库发布窗口的默认审批人'],
    note: '王芳负责的是 CRM，不是知识库。',
  },
  {
    id: 'sop-postmortem',
    question: '线上 incident 的复盘要在多久内提交？',
    intent: 'knowledge',
    expectRefuse: false,
    gold: [{ chunkId: SOP_AFTER, documentId: SOP, mustContain: '72' }],
    keyPoints: ['72 小时内把复盘文档提交到知识库'],
    note: '只针对 incident 级别故障。安全审计是另一条 7 日内。',
  },
  {
    id: 'bonus-month',
    question: '本公司年终奖在几月发放？',
    intent: 'knowledge',
    expectRefuse: true,
    gold: [],
    keyPoints: [],
    note: '库里没有年终奖制度。公开网页也不能当成公司内部数字。标准行为是拒答。',
  },
  {
    id: 'door-time',
    question: '成都研发中心晚上几点锁门？',
    intent: 'knowledge',
    expectRefuse: true,
    gold: [],
    keyPoints: [],
    note: '差旅办法只写了成都住宿上限，没有门禁时间。',
  },
  {
    id: 'hangzhou-weather',
    question: '今天杭州天气怎么样？',
    intent: 'web',
    expectRefuse: false,
    gold: [],
    keyPoints: ['提到杭州', '给出天气状况或气温'],
    note: '不评检索。预报每天变化，所以不要求某一个温度。',
  },
  {
    id: 'qingcheng-weather',
    question: '青城山明天天气如何，适合爬山吗？',
    intent: 'web',
    expectRefuse: false,
    gold: [],
    keyPoints: ['提到青城山', '给出青城山的天气、气温或降水'],
    note: '用来看联网不切题后有没有改写。搜成别的山再据之回答，忠实度应失败；直接拒答则相关性失败。',
  },
  {
    id: 'beijing-weather-if-missing',
    question: '制度里如果没有，请再查一下北京明天的天气。',
    intent: 'knowledge_then_web',
    expectRefuse: false,
    gold: [],
    keyPoints: ['提到北京', '给出天气状况或气温'],
    note: '先查知识库，没有再联网。知识库里没有天气预报，所以不设必需切片。',
  },
  {
    id: 'hello',
    question: '你好',
    intent: 'chat',
    expectRefuse: false,
    gold: [],
    keyPoints: [],
    note: '闲聊不查知识库，也不评检索和完整性。回答里如果编出制度，忠实度记 0。',
  },
  {
    id: 'standup-opening',
    question: '帮我写一句周一站会的开场白，不要提公司制度。',
    intent: 'chat',
    expectRefuse: false,
    gold: [],
    keyPoints: [],
    note: '发布流程里有周一站会，但这题要求不查制度，只看会不会编造内部规定。',
  },
  {
    id: 'favorite-food',
    question: '我平时喜欢吃什么？',
    intent: 'preference',
    expectRefuse: true,
    gold: [],
    keyPoints: [],
    note: '评测不加载 Mem0 和 Redis。没有记忆时应该拒答，而不是编一个口味。',
  },
];
