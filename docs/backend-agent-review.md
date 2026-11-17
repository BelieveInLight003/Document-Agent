# backend AI Agent 模块审查清单

审查日期：2026-11-12。审查对象：`/Users/balala/Desktop/workspace/Summary/backend` 当前工作区，包含已有未提交修改。本次未修改项目源码。

## 审查结论

当前项目已具备意图路由、混合检索、图谱检索、联网补充、流式回答、短期与长期记忆、评测和追踪。执行核心是固定决策的 RAG 工作流。对于公司知识库问答，这个形态可以继续使用，无须为了“Agent”名称先换框架。

优先应调整权限边界、文档与索引一致性、执行取消、故障分类和追踪隔离。否则，即使增加工具或模型能力，也会放大现有问题。

P1 表示应优先修复的权限、数据正确性或可用性问题；P2 表示后续应处理的检索质量、记忆和验证问题。以下结论以代码检查为基础，另有三个问题完成了隔离复现；未将推断表述为已发生的线上事故。

## 1. P1：文档接口的权限边界与 Agent 检索不一致

- 位置：[document.controller.ts:50](/Users/balala/Desktop/workspace/Summary/backend/src/document/document.controller.ts:50)、[document.service.ts:305](/Users/balala/Desktop/workspace/Summary/backend/src/document/document.service.ts:305)、[document.service.ts:341](/Users/balala/Desktop/workspace/Summary/backend/src/document/document.service.ts:341)。
- 问题：列表和详情仅校验菜单或列表权限，没有接收当前用户，也没有按作者、公开状态或角色逐文档判断。列表还直接拼接正文。初始化权限给普通用户授予了文档列表权限。
- 影响：检索端会过滤的其他人私有文档，可经文档列表或详情接口读到。草稿也没有相应的对象权限判断。Agent 的引用入口不能弥补这一缺口。
- 调整：让列表、详情、引用原文和修改入口统一接收当前用户，执行逐文档授权。草稿编辑可建立单独规则，不必照搬“仅允许已发布文档检索”的规则。
- 相关问题：修改接口同样不检查目标文档作者；普通用户若被授予编辑权限，即可修改任意文档。必须将接口操作权限与对象权限分开校验。

## 2. P1：文档更新与审核状态可以绕开索引生命周期

- 位置：[document.service.ts:351](/Users/balala/Desktop/workspace/Summary/backend/src/document/document.service.ts:351)、[document.service.ts:121](/Users/balala/Desktop/workspace/Summary/backend/src/document/document.service.ts:121)、[document.service.ts:227](/Users/balala/Desktop/workspace/Summary/backend/src/document/document.service.ts:227)。
- 问题：更新正文只改 MongoDB 和 PostgreSQL，不重建向量、全文和图谱索引；已发布文档再次调用 publish 会直接返回“文档已发布”。创建和修改还允许请求直接指定 status、authorId 等业务敏感字段。
- 影响：文档页面已经显示新制度，Agent 仍使用旧切片回答；创建时指定已发布状态可跳过正常发布处理，修改状态也可绕过审核流程。
- 调整：服务端控制作者与状态迁移；为正文增加不可变版本号或内容摘要，明确“编辑后重新审核”或“发布新版本”的行为，按版本重建索引。

## 3. P1：发布管线与消息队列缺少一致性及恢复机制

- 位置：[pipeline-manager.service.ts:42](/Users/balala/Desktop/workspace/Summary/backend/src/pipelineManager/pipeline-manager.service.ts:42)、[document.service.ts:127](/Users/balala/Desktop/workspace/Summary/backend/src/document/document.service.ts:127)、[rabbitmq.consumer.ts:109](/Users/balala/Desktop/workspace/Summary/backend/src/mq/rabbitmq.consumer.ts:109)、[rabbitmq.publisher.ts:45](/Users/balala/Desktop/workspace/Summary/backend/src/mq/rabbitmq.publisher.ts:45)。
- 问题：三条索引消息依次发布，之后才保存文档发布状态，中间失败可能只完成部分动作。消息中没有文档版本，消费者也不核对当前发布版本。向量和图谱更新采用先删除旧数据再写入新数据。
- 影响：可能出现文档状态、向量索引、全文索引和图谱互不一致；较慢的旧任务可能覆盖更新结果；重建失败会造成检索空窗。
- 队列补充：发布和重试没有使用 broker 确认通道，重试发布后立即 ack 原消息；超限 nack 后没有配置死信去向；消费者没有设置 prefetch，也缺少连接关闭后的状态复位与重连。
- 调整：使用事务 outbox 或等效的可靠事件记录，事件带 documentId/version/jobId；消费者幂等处理并拒绝旧版本；维护各索引任务状态和可重试记录；新版本就绪后再切换；补齐发布确认、消费并发上限、退避重试和失败队列。

## 4. P1：Agent 的取消、耗时与调用预算没有覆盖全链路

- 位置：[chat-session.service.ts:189](/Users/balala/Desktop/workspace/Summary/backend/src/ai/chat-session.service.ts:189)、[chat-session.controller.ts:76](/Users/balala/Desktop/workspace/Summary/backend/src/ai/chat-session.controller.ts:76)、[agent-route.ts:47](/Users/balala/Desktop/workspace/Summary/backend/src/ai/agent-route.ts:47)、[agent-grade.ts:47](/Users/balala/Desktop/workspace/Summary/backend/src/ai/agent-grade.ts:47)、[agent-loop.ts:71](/Users/balala/Desktop/workspace/Summary/backend/src/ai/agent-loop.ts:71)。
- 问题：整理问题结束后才创建 AbortController，控制器也在 openStream 返回后才监听断开。路由、评估、改写等模型调用不接收 signal，文档和图谱工具接口也不接收 signal；主要只有最终流式生成和联网请求具备取消信号。
- 影响：用户在准备、路由或评估期间关闭页面，后台调用仍可能持续执行；准备阶段断开还可能错过 close 事件。
- 预算问题：TOOL_BUDGET 统计的是部分流程步骤，既不统计图谱底层调用，也不统计完整模型和联网调用，不能代表实际成本上限。
- 调整：从请求开始建立运行上下文，传递取消信号、总耗时上限、各工具超时和真实调用计数；连接断开时取消整个执行过程，持久化明确的运行状态。
- 注意：已核对本地安装的 AI SDK，当前 pipeUIMessageStreamToResponse 返回 Promise；这里不属于“await 无效”的问题。

## 5. P1：检索模块把故障当成无结果

- 位置：[hybrid-retriever.ts:59](/Users/balala/Desktop/workspace/Summary/backend/src/ai/hybrid-retriever.ts:59)、[hybrid-retriever.ts:86](/Users/balala/Desktop/workspace/Summary/backend/src/ai/hybrid-retriever.ts:86)、[agent-grade.ts:75](/Users/balala/Desktop/workspace/Summary/backend/src/ai/agent-grade.ts:75)。
- 问题：关键词与向量检索各自 catch 后返回空数组。当索引存在性检查成功、后续两个检索渠道均失败时，整体仍成功返回空数组。评估模型失败也被映射为 partial。
- 影响：上层分不清“资料不存在”“搜索服务故障”和“评估服务故障”，可能错误拒答、重复改写或启动联网。
- 调整：工具返回结构化状态，区分成功、空结果、部分降级、不可用、超时和取消。单路失败可用另一条路；全部失败应明确报不可用。评估故障应执行独立降级策略。
- 验证：使用模拟搜索客户端和向量服务，复现两个检索渠道同时抛错，retrieveChunks 仍返回 `[]`。

## 6. P1：追踪上报故障会传播到问答业务

- 位置：[langsmith.ts:104](/Users/balala/Desktop/workspace/Summary/backend/src/ai/langsmith.ts:104)、[langfuse.ts:111](/Users/balala/Desktop/workspace/Summary/backend/src/ai/langfuse.ts:111)。
- 问题：业务函数成功之后，child.end / child.patchRun 与业务代码处在同一个 try 中；上报失败会进入 catch 并被重新抛出。Langfuse 的 child.update/end 也存在类似耦合。
- 影响：检索或生成已经成功，但追踪服务故障仍可能让路由退回默认值、让检索被判失败，或者中断回答；多个上报 await 还进入请求关键路径。
- 调整：业务执行与观测写入分别处理异常，上报失败只记录；尽可能异步缓冲和批量发送，关闭应用时统一刷新。

## 7. P2：图谱检索丢失原文条件和引用信息

- 位置：[graph-passages.ts:36](/Users/balala/Desktop/workspace/Summary/backend/src/ai/graph-passages.ts:36)、[graph.service.ts:334](/Users/balala/Desktop/workspace/Summary/backend/src/graph/graph.service.ts:334)。
- 问题：RELATED 的两端都是 Entity。graphPassages 只从两端找 document、contentId 和 contentPreview，没有使用关系上的 documentId/chunkId 去关联结果中已经存在的 Document/Chunk。
- 影响：经常只给模型“实体 A—关系→实体 B”，丢掉审批金额、生效时间、适用范围等原文条件；标题退回“知识图谱”，contentId 为空，引用也不完整。
- 调整：按 relation.documentId 和 relation.chunkId 回连文档与切片，把原文证据与关系一起送入评估和生成；图谱用于定位和补充证据，不能替代带条件的制度原文。
- 验证：构造包含 Document、Chunk 和实体关系的子图，复现文档标题、正文 ID 和切片中的金额条件均未进入 passage。

## 8. P2：长期记忆检索到了，却没传给普通问答生成

- 位置：[chat-stream.ts:270](/Users/balala/Desktop/workspace/Summary/backend/src/ai/chat-stream.ts:270)、[prompt.ts:47](/Users/balala/Desktop/workspace/Summary/backend/src/ai/prompt.ts:47)。
- 问题：promptOf 接收 longTerm，但普通回答分支只调用 answerPrompt(question, items, memory)，漏传第四个参数。preference 分支则正常传入。
- 影响：单独询问个人偏好可能正常，但“结合我的岗位/偏好解释制度”这类混合问题无法在最终生成阶段利用已召回的长期信息。
- 调整：补齐参数传递，并覆盖普通问答、个人偏好和混合问题的上下文测试。
- 验证：向 promptOf 传入唯一记忆标记，普通 answer 提示词没有该标记，preference 提示词包含该标记。

## 9. P2：短期记忆有并发覆盖，Redis 故障也不能完整降级

- 位置：[chat-memory.service.ts:64](/Users/balala/Desktop/workspace/Summary/backend/src/ai/chat-memory.service.ts:64)、[chat-memory.service.ts:85](/Users/balala/Desktop/workspace/Summary/backend/src/ai/chat-memory.service.ts:85)、[chat-session.service.ts:75](/Users/balala/Desktop/workspace/Summary/backend/src/ai/chat-session.service.ts:75)。
- 问题：remember 使用读、追加、压缩、写回，整个操作没有版本比较或会话串行控制；同一会话的两个请求可能读到同一份记忆，后写入的覆盖前一个。
- 降级问题：读取 Redis 异常会降级为空，但 load 从数据库恢复后再次写 Redis 的错误没有被隔离，可能直接阻断准备问题。
- 影响：并发提问丢失上下文；Redis 不可用时，即使 PostgreSQL 保存着历史，也不能保证问答继续。
- 调整：同一会话串行执行，或使用版本号和原子更新；以数据库消息顺序作为恢复依据；将缓存读取、续期和写入全部视为可降级操作。

## 10. P2：权限过滤放在固定候选截断之后，容易漏掉可读文档

- 位置：[ai.service.ts:94](/Users/balala/Desktop/workspace/Summary/backend/src/ai/ai.service.ts:94)、[hybrid-retriever.ts:8](/Users/balala/Desktop/workspace/Summary/backend/src/ai/hybrid-retriever.ts:8)、[graph.service.ts:52](/Users/balala/Desktop/workspace/Summary/backend/src/graph/graph.service.ts:52)。
- 问题：文档检索各路固定取 20 条，融合再截为 20 条，之后才按权限过滤。图谱也先 LIMIT seed，再做权限裁剪。
- 影响：如果前面的候选均为用户无权读取的文档，后面的公开相关文档根本没有机会进入结果；库内存在可读答案仍可能拒答。这是召回问题，不是当前检索过滤直接泄露内容。
- 调整：将可读范围用于检索前过滤，并保留最终授权复核；或采用可控的递增候选补查，直到取得足够可读结果或达到扫描预算。

## 11. P2：多轮检索不合并证据，导致组合问题错误拒答

- 位置：[agent-loop.ts:77](/Users/balala/Desktop/workspace/Summary/backend/src/ai/agent-loop.ts:77)、[agent-loop.ts:118](/Users/balala/Desktop/workspace/Summary/backend/src/ai/agent-loop.ts:118)。
- 问题：第二轮只评估 second.items，没有合并第一轮资料。进入联网后也只使用网页资料。
- 影响：例如“谁审批、多久到账”，第一轮找到了审批人，第二轮找到了到账时间，两轮分别不足但合起来足够，当前流程仍可能拒答。
- 调整：在运行状态中保留按来源去重的证据池，记录各子问题已覆盖和缺失的事实；针对缺失事实检索，再对累计证据评估。内部与外部证据必须保留来源边界。

## 12. P2：评测和单元测试未覆盖核心业务风险

- 位置：[eval-dataset.ts:12](/Users/balala/Desktop/workspace/Summary/backend/src/ai/eval/eval-dataset.ts:12)、[eval-run-case.ts:44](/Users/balala/Desktop/workspace/Summary/backend/src/ai/eval/eval-run-case.ts:44)、[eval-report.ts:148](/Users/balala/Desktop/workspace/Summary/backend/src/ai/eval/eval-report.ts:148)。
- 问题：评测默认以管理员身份运行，记忆为空，数据集明确未覆盖多轮追问、已有偏好、普通用户权限和图谱独立命中。故障题及未评结果不进入部分指标平均分。现有单元测试只有三个文件。
- 影响：普通用户越权、记忆失效、并发覆盖、断开后继续执行等问题不影响现有测试通过；只看平均分也可能忽略大量执行失败。
- 调整：补充普通用户权限、跨用户/跨会话隔离、多轮检索组合、记忆召回、取消超时、索引版本和依赖故障的用例；报告同时展示完成率、错误率、拒答准确率、各项有效样本数、耗时和调用成本。
- 指标命名：当前 recall 定义为“必需切片全部找到才为 1”，建议明确称为全证据命中率，并另报按比例计算的召回率，避免解释混淆。

## 验证范围

- TypeScript 类型检查通过：`tsc --noEmit --incremental false --project tsconfig.build.json`。
- 现有单元测试通过：3 个文件、12 个测试。使用不生成配置打包临时文件的配置加载方式运行，未修改项目配置。
- 完成三个不访问外部服务的隔离复现：普通回答漏传长期记忆、图谱 passage 丢失原文条件与来源信息、双路检索异常返回空结果。
- 未运行依赖真实数据库、消息队列和付费模型的端到端评测，因此没有声称已复现线上越权请求、消息丢失或全部并发时序。

## 建议实施顺序

1. 先统一逐文档授权，限制客户端直接修改作者与状态。
2. 修正文档更新、发布、索引版本和消息可靠性。
3. 建立贯穿全链路的取消、超时、预算和错误状态，隔离追踪故障。
4. 修复记忆传递、缓存降级、图谱原文证据与多轮证据合并。
5. 用普通用户和故障场景建立回归测试，再衡量是否需要扩展为更多业务工具。

## 作为 Agent 的后续能力

如果产品目标始终是制度问答，固定流程可以继续保持。如果目标是执行多步业务任务，则还需要统一工具输入输出、按用户授权的工具集合、工具幂等键、运行状态持久化、失败恢复和必要的人为确认。这属于产品范围扩展，应与上述确定缺陷分开排期。
