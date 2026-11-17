# Agent reliability changes

## Document API

- Document lists, details, review submission, editing and removal now check the authenticated user's access to the target document.
- New documents always start as drafts. The authenticated user supplies the author and audit identity; request-supplied identity fields cannot impersonate another user.
- Generic updates cannot change publication state, author or publication time.
- Editing the title, summary or body of a published document creates a new immutable body snapshot and returns the document to draft. It must pass the review/publication workflow again.
- Only administrators can use the direct publication endpoint. Review approval remains controlled by the review permission.
- Owners and reviewers can view drafts; only published documents enter search and Agent retrieval.
- Deletion is now soft deletion. Body snapshots remain available for recovery; ordinary document endpoints hide deleted records.

## Asynchronous indexing

At application startup, the existing schema initialization pattern creates `kh_pipeline_job` if it does not exist. Publication and cleanup jobs are inserted through the same PostgreSQL transaction as the document state change.

The worker polls every five seconds. Each event produces independent vector, full-text and graph jobs. Consumers check body version and publication time both before extraction and before committing the index. A document advisory lock protects the final write against concurrent state changes; model extraction runs outside that lock.

Publication is asynchronous. A published document can take time to become searchable. Retrieval excludes old body snapshots while indexing catches up; it does not silently serve a previous version as the current document.

Chunk IDs are stable within a document body version. Vector writes complete before superseded chunks are removed. Graph replacement uses a single Neo4j write transaction.

Job states:

| State     | Meaning                                                 |
| --------- | ------------------------------------------------------- |
| pending   | Awaiting delivery, or scheduled for retry               |
| queued    | Broker has confirmed delivery; awaiting completion      |
| completed | Current-version index work completed                    |
| obsolete  | The document was changed, removed or republished        |
| failed    | Processing retry limit reached; retained for inspection |

Processing errors use delayed retries, up to six processing attempts. Uncompleted queued deliveries are eligible for delivery again after fifteen minutes. Stable IDs and version checks make duplicate delivery recoverable. Completed and obsolete jobs are not reset by a failing duplicate.

Administrator endpoints:

- `GET /pipeline/jobs`: recent 100 jobs, including state and latest error.
- `POST /pipeline/jobs/:id/retry`: requeue a failed or queued job.

The RabbitMQ publisher uses broker confirmations. Consumers limit unacknowledged work, publish delayed retries before acknowledging the original, and retain exhausted legacy messages in `<queue>.failed`. Existing main queues do not require changed queue arguments. New `<queue>.retry` and `<queue>.failed` queues are declared automatically.

## Agent execution and memory

- One running request per chat session. Concurrent requests receive HTTP 409.
- `kh_chat_run` is initialized at startup. Its three-minute leases renew every ten seconds; crashed processes do not leave permanent locks. Tokens fence message persistence against expired runs. No connection is held for the entire model response.
- Default execution limits: 120 seconds total, 30 seconds per model request, 16 model calls and 20 tool operations. Evaluation cases use a 180-second total deadline.
- Tool operations have individual timeouts; provider retries for interactive generation are disabled. SDKs without cancellation support are bounded at the caller, although their underlying request may finish later.
- Disconnect detection is registered before question preparation. Abort signals reach model calls, Elasticsearch requests, web search and graph retrieval.
- Responses persist `completed`, `failed` or `aborted` in message payloads, with model/tool call counts. Failed and interrupted responses are excluded from normal memory retention.
- Redis failures fall back to database history. Cache refresh failure does not block a valid history snapshot.
- Long-term memory reaches ordinary knowledge answers as well as preference answers.
- Evidence is accumulated across retrieval rounds. Graph evidence includes its original chunk and document provenance.
- Tracing failures are isolated from business results, and network reporting is asynchronous.

## Verification

Run:

```sh
pnpm exec tsc --noEmit --incremental false -p tsconfig.json
pnpm exec vitest run --cache=false --configLoader runner
pnpm lint
```

Unit-test setup prevents live model and tracing credentials from being loaded from `.env`.

The evaluation report separates proportional recall from all-evidence hit rate, includes failed cases in execution statistics, and reports valid metric sample counts, refusal accuracy, latency and model/tool calls. Call counts are not a monetary cost calculation.

Regression tests use simulated service failures. Real PostgreSQL, RabbitMQ, Elasticsearch, Neo4j and model integration should be exercised in an isolated environment before rollout. Existing production databases and queues are not modified by running the unit tests.
