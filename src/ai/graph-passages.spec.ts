import { describe, expect, it } from 'vitest';
import { graphPassages } from './graph-passages.js';
import type { GraphNodeView, GraphView } from '../graph/graph.view.js';

const node = (id: string, fields: Partial<GraphNodeView>): GraphNodeView => ({
  id,
  label: 'Entity',
  name: id,
  entityType: null,
  documentId: null,
  contentId: null,
  chunkId: null,
  title: null,
  index: null,
  contentPreview: null,
  document: null,
  ...fields,
});
const graph: GraphView = {
  nodes: [
    node('doc', {
      label: 'Document',
      documentId: '123',
      contentId: 'body',
      document: {
        id: '123',
        contentId: 'body',
        title: 'Expense policy',
        summary: null,
        status: 1,
      },
    }),
    node('chunk', {
      label: 'Chunk',
      documentId: '123',
      chunkId: 'c1',
      content: 'Only expenses above 5000 require director approval.',
    }),
    node('employee', {}),
    node('director', {}),
  ],
  relations: [
    {
      id: 'r1',
      type: 'RELATED',
      name: 'requires approval',
      source: 'employee',
      target: 'director',
      documentId: '123',
      chunkId: 'c1',
      index: null,
    },
  ],
};

describe('graph evidence', () => {
  it('preserves original conditions and document provenance', () => {
    const [passage] = graphPassages(graph, 5);
    expect(passage).toMatchObject({
      title: 'Expense policy',
      contentId: 'body',
      documentId: '123',
      chunkId: 'c1',
    });
    expect(passage.content).toContain('above 5000');
  });
  it('does not answer from bare entity names or unsupported relations', () => {
    expect(
      graphPassages(
        {
          nodes: graph.nodes.filter((item) => item.label === 'Entity'),
          relations: graph.relations,
        },
        5,
      ),
    ).toEqual([]);
  });
  it('falls back to full source chunks when semantic relations are absent', () => {
    expect(graphPassages({ ...graph, relations: [] }, 5)[0].content).toContain(
      'above 5000',
    );
  });
});
