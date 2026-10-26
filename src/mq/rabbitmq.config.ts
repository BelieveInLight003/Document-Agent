/**
 * RabbitMQ 基本配置。
 * 发布端用它声明交换机、队列和绑定，订阅端用它确定要消费的队列。
 * 调用时再读 .env，避免模块加载时环境变量还没注入。
 */
export function getRabbitmqConfig() {
  return {
    url: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@127.0.0.1:5672',
    exchange: process.env.RABBITMQ_EXCHANGE ?? 'knowledge_hub.pipeline',
    exchangeType: (process.env.RABBITMQ_EXCHANGE_TYPE ?? 'topic') as
      | 'direct'
      | 'topic'
      | 'fanout'
      | 'headers',
    queues: {
      published:
        process.env.RABBITMQ_QUEUE_PUBLISHED ??
        'knowledge_hub.document.published',
      keyword:
        process.env.RABBITMQ_QUEUE_KEYWORD ??
        'knowledge_hub.document.keyword',
      graph:
        process.env.RABBITMQ_QUEUE_GRAPH ?? 'knowledge_hub.document.graph',
    },
    routingKeys: {
      published:
        process.env.RABBITMQ_ROUTING_KEY_PUBLISHED ?? 'document.published',
      keyword:
        process.env.RABBITMQ_ROUTING_KEY_KEYWORD ?? 'document.keyword',
      graph: process.env.RABBITMQ_ROUTING_KEY_GRAPH ?? 'document.graph',
    },
  };
}
