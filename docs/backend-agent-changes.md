# backend Agent 调整说明

已直接修改 `/Users/balala/Desktop/workspace/Summary/backend`。本次修改保留现有框架与依赖，没有提交 Git，也没有启动真实数据库、队列或模型调用。

## 对应审查问题的调整

| 审查项 | 已实现的调整 |
| --- | --- |
| 文档权限 | 列表、详情、编辑、删除和审核提交接入当前用户；按文档检查公开状态、作者和角色；拒绝读取其他作者的私有正文。 |
| 状态与索引更新 | 新文档从草稿开始，作者和操作人由服务端设置；普通更新不能直接发布或更换作者。已发布正文、标题、摘要修改后生成新内容快照并退回草稿，需重新审核发布。 |
| 发布及消息可靠性 | 文档状态和三路索引任务在同一 PostgreSQL 事务保存。增加持久化任务状态、错误信息、延迟重试、旧版本跳过和管理员重试入口。RabbitMQ 使用发布确认、消费并发限制、重连和失败队列。 |
| 取消与预算 | 请求准备前监听断开；模型、检索和工具操作使用统一运行上下文，限制总耗时、单次调用和模型/工具操作数量。 |
| 检索故障分类 | 全部渠道失败，或部分故障且没有可用证据时，报告不可用；有可用结果时保留健康渠道。评估故障不再作为“资料部分相关”继续改写。 |
| 追踪隔离 | 上报失败不覆盖业务成功结果或原始异常；上报网络请求移出主要执行等待路径。 |
| 图谱证据 | 按关系关联文档及原文切片，保留适用条件、标题和正文 ID；不再把孤立实体名称作为答案证据。 |
| 长期记忆 | 普通知识问答也传入召回的长期记忆，修复只在偏好分支生效的问题。 |
| 短期记忆与并发 | Redis 写入失败不阻断数据库历史恢复；同会话使用可续期、带令牌的数据库租约，过期请求不能继续保存消息；并发提问返回 409。 |
| 权限与召回 | 文档和图谱在候选截断前限制可读范围，并再次核对当前权限和正文版本。 |
| 多轮证据 | 累计并去重前后两轮及联网补充证据，再进行充分性评估；保留资料来源边界。 |
| 评测与回归 | 增加权限、审核状态、记忆、超时取消、索引版本、消息故障及追踪隔离测试。评测加入完成率、失败数、拒答准确率、耗时、调用数和有效样本数；区分比例召回与全证据命中。 |

## 关键代码

- [文档访问策略](/Users/balala/Desktop/workspace/Summary/backend/src/document/document-access.ts)
- [文档更新及版本处理](/Users/balala/Desktop/workspace/Summary/backend/src/document/document.service.ts:388)
- [持久化发布任务与版本检查](/Users/balala/Desktop/workspace/Summary/backend/src/pipelineManager/pipeline-manager.service.ts:94)
- [Agent 运行上下文](/Users/balala/Desktop/workspace/Summary/backend/src/ai/agent-runtime.ts:12)
- [会话租约和过期写入保护](/Users/balala/Desktop/workspace/Summary/backend/src/ai/chat-session.service.ts:403)
- [多轮证据处理](/Users/balala/Desktop/workspace/Summary/backend/src/ai/agent-loop.ts)
- [图谱原文证据](/Users/balala/Desktop/workspace/Summary/backend/src/ai/graph-passages.ts:27)
- [长期记忆传递](/Users/balala/Desktop/workspace/Summary/backend/src/ai/chat-stream.ts:369)
- [项目内运行说明](/Users/balala/Desktop/workspace/Summary/backend/docs/agent-reliability.md)

## 使用变化

- 重启应用后，沿用项目已有的启动建表方式，自动补建 `kh_pipeline_job` 和 `kh_chat_run`。
- 索引仍然异步构建，发布后需要等待任务完成才能检索到新版本；期间不会将旧正文作为当前版本返回。
- 管理员可通过 `GET /pipeline/jobs` 查看最近任务，通过 `POST /pipeline/jobs/:id/retry` 重试失败或长时间未完成的任务。
- 直接发布接口只允许管理员使用；其他用户应通过提交审核和审核通过完成发布。
- 文档删除改为软删除，历史正文快照保留用于恢复；普通接口隐藏已删除文档。
- 交互式 Agent 默认总耗时 120 秒、单次模型调用 30 秒、最多 16 次模型调用和 20 次工具操作。调用数不等同于实际货币成本。
- 不支持原生取消的第三方 SDK 使用调用方超时边界，其底层请求可能稍后结束。

## 验证结果

- 21 个测试文件、80 个测试通过，较原有 12 个测试新增 68 个回归测试。
- 包含测试代码的完整 TypeScript 类型检查通过。
- 代码检查：0 错误、0 警告。
- Git 差异格式检查通过。

真实 PostgreSQL、RabbitMQ、Elasticsearch、Neo4j 与模型的端到端联调尚未执行；目前故障和并发场景使用隔离模拟验证。上线前应在隔离环境检查首次启动建表、真实消息重投与断线恢复、索引重建及客户端对 409 的处理。
