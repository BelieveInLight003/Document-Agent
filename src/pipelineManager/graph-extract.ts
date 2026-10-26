import { ChatOpenAI } from '@langchain/openai';

export type EntityRule = {
  type: string;
  description: string;
};

export type RelationRule = {
  type: string;
  sourceType: string;
  targetType: string;
  description: string;
};

export type GraphRules = {
  entityRules: EntityRule[];
  relationRules: RelationRule[];
};

export type ExtractedEntity = {
  name: string;
  type: string;
};

export type ExtractedRelation = {
  source: string;
  sourceType: string;
  target: string;
  targetType: string;
  type: string;
};

const ruleSourceLimit = 12000;

/** 按当前 .env 初始化对话模型。百炼兼容接口，调用时再读配置。 */
function createChat() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 OPENAI_API_KEY');
  }

  return new ChatOpenAI({
    apiKey,
    model: process.env.CHAT_MODEL ?? 'qwen-plus',
    temperature: 0,
    configuration: {
      baseURL:
        process.env.OPENAI_BASE_URL ??
        process.env.EMBEDDING_BASE_URL ??
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
  });
}

/** 根据整篇文档归纳实体规则和关系规则。正文过长时只用开头一段来定规则。 */
export async function inferGraphRules(
  title: string,
  content: string,
): Promise<GraphRules> {
  const source =
    content.length > ruleSourceLimit
      ? content.slice(0, ruleSourceLimit)
      : content;
  const response = await createChat().invoke(
    [
      '你是知识图谱设计助手。阅读文档后，给出适合这篇文档的实体类型规则和关系类型规则。',
      '只输出 JSON，不要解释，不要使用 markdown。',
      '格式：{"entityRules":[{"type":"类型名","description":"什么样的内容算这类实体"}],"relationRules":[{"type":"关系名","sourceType":"起点实体类型","targetType":"终点实体类型","description":"什么时候建立这条关系"}]}',
      '类型名用简短中文。sourceType 和 targetType 必须出现在 entityRules 的 type 里。规则覆盖文档里的主要内容，数量适中。',
      `标题：${title}`,
      `正文：${source}`,
    ].join('\n'),
  );
  const rules = asRules(parseJsonObject(messageText(response.content)));
  if (rules.entityRules.length === 0) {
    throw new Error('实体规则为空');
  }
  return rules;
}

/** 按已经确定的规则，从单个切片里抽取实体和关系。 */
export async function extractChunkGraph(
  rules: GraphRules,
  content: string,
): Promise<{ entities: ExtractedEntity[]; relations: ExtractedRelation[] }> {
  const response = await createChat().invoke(
    [
      '按给定的实体规则和关系规则，从片段中抽取实体和关系。',
      '只输出 JSON，不要解释，不要使用 markdown。',
      '实体的 type 必须来自实体规则。关系的 type、sourceType、targetType 必须来自关系规则。',
      '不要编造片段里没有的内容。同一名称同一类型只出现一次。',
      '格式：{"entities":[{"name":"","type":""}],"relations":[{"source":"","sourceType":"","target":"","targetType":"","type":""}]}',
      `实体规则：${JSON.stringify(rules.entityRules)}`,
      `关系规则：${JSON.stringify(rules.relationRules)}`,
      `片段：${content}`,
    ].join('\n'),
  );
  return normalizeExtraction(
    asExtraction(parseJsonObject(messageText(response.content))),
    rules,
  );
}

function normalizeExtraction(
  extracted: { entities: ExtractedEntity[]; relations: ExtractedRelation[] },
  rules: GraphRules,
) {
  const entityTypes = new Set(rules.entityRules.map((rule) => rule.type));
  const entities = dedupe(
    extracted.entities.filter(
      (entity) => entity.name && entityTypes.has(entity.type),
    ),
    (entity) => entityKey(entity.type, entity.name),
  );
  const relations = dedupe(
    extracted.relations.flatMap((relation) => {
      const rule = rules.relationRules.find(
        (item) => item.type === relation.type,
      );
      if (!rule) {
        return [];
      }
      const source = resolveEntity(
        relation.source,
        relation.sourceType || rule.sourceType,
        entities,
      );
      const target = resolveEntity(
        relation.target,
        relation.targetType || rule.targetType,
        entities,
      );
      if (!source || !target) {
        return [];
      }
      if (source.type !== rule.sourceType || target.type !== rule.targetType) {
        return [];
      }
      if (
        entityKey(source.type, source.name) ===
        entityKey(target.type, target.name)
      ) {
        return [];
      }
      return [
        {
          source: source.name,
          sourceType: source.type,
          target: target.name,
          targetType: target.type,
          type: rule.type,
        },
      ];
    }),
    (relation) =>
      [
        relation.type,
        relation.sourceType,
        relation.source,
        relation.targetType,
        relation.target,
      ].join('\0'),
  );
  return { entities, relations };
}

function resolveEntity(
  name: string,
  type: string,
  entities: ExtractedEntity[],
) {
  const exact = entities.find(
    (entity) => entity.name === name && entity.type === type,
  );
  if (exact) {
    return exact;
  }
  const sameName = entities.filter((entity) => entity.name === name);
  return sameName.length === 1 ? sameName[0] : undefined;
}

function asRules(value: unknown): GraphRules {
  const record = asRecord(value);
  return {
    entityRules: asList(record.entityRules).flatMap((item) => {
      const rule = asRecord(item);
      const type = asText(rule.type);
      if (!type) {
        return [];
      }
      return [{ type, description: asText(rule.description) }];
    }),
    relationRules: asList(record.relationRules).flatMap((item) => {
      const rule = asRecord(item);
      const type = asText(rule.type);
      const sourceType = asText(rule.sourceType);
      const targetType = asText(rule.targetType);
      if (!type || !sourceType || !targetType) {
        return [];
      }
      return [
        {
          type,
          sourceType,
          targetType,
          description: asText(rule.description),
        },
      ];
    }),
  };
}

function asExtraction(value: unknown) {
  const record = asRecord(value);
  return {
    entities: asList(record.entities).flatMap((item) => {
      const entity = asRecord(item);
      const name = asText(entity.name);
      const type = asText(entity.type);
      if (!name || !type) {
        return [];
      }
      return [{ name, type }];
    }),
    relations: asList(record.relations).flatMap((item) => {
      const relation = asRecord(item);
      const source = asText(relation.source);
      const target = asText(relation.target);
      const type = asText(relation.type);
      if (!source || !target || !type) {
        return [];
      }
      return [
        {
          source,
          sourceType: asText(relation.sourceType),
          target,
          targetType: asText(relation.targetType),
          type,
        },
      ];
    }),
  };
}

function parseJsonObject(text: string) {
  const fenced = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error(`模型没有返回 JSON：${raw.slice(0, 200)}`);
  }
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

function messageText(content: unknown) {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (
        part &&
        typeof part === 'object' &&
        'text' in part &&
        typeof part.text === 'string'
      ) {
        return part.text;
      }
      return '';
    })
    .join('');
}

function asRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asList(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function entityKey(type: string, name: string) {
  return `${type}\0${name}`;
}

function dedupe<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}
