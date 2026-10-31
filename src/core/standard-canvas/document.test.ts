import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  NODE_SIZES,
  createDefaultDocument,
  createNode,
  inputPort,
  linkPath,
  loadStandardDocument,
  outputPort,
  parseStandardDocument,
  serializeStandardDocument,
} from './document';

describe('createNode', () => {
  test('takes its size from the kind', () => {
    const node = createNode('scene', { x: 10, y: 20 });
    assert.equal(node.width, NODE_SIZES.scene.width);
    assert.equal(node.height, NODE_SIZES.scene.height);
    assert.equal(node.kind, 'scene');
  });

  test('rounds the position, because half pixels shimmer', () => {
    const node = createNode('role', { x: 10.4, y: 20.6 });
    assert.equal(node.x, 10);
    assert.equal(node.y, 21);
  });

  test('gives every node a distinct id', () => {
    const ids = new Set(Array.from({ length: 20 }, () => createNode('role', { x: 0, y: 0 }).id));
    assert.equal(ids.size, 20);
  });
});

describe('createDefaultDocument', () => {
  test('starts with a role, a scene and a setting', () => {
    const doc = createDefaultDocument();
    assert.deepEqual(
      doc.nodes.map((node) => node.kind),
      ['role', 'scene', 'setting']
    );
    assert.equal(doc.links.length, 0);
    assert.equal(doc.viewport.zoom, 1);
  });
});

describe('parseStandardDocument', () => {
  test('round-trips a document through JSON', () => {
    const doc = createDefaultDocument();
    doc.nodes[0].name = '阿明';
    const parsed = parseStandardDocument(JSON.parse(serializeStandardDocument(doc)));
    assert.equal(parsed.nodes[0].name, '阿明');
    assert.equal(parsed.nodes.length, 3);
  });

  test('drops links that point at missing nodes', () => {
    const doc = createDefaultDocument();
    const [role, scene] = doc.nodes;
    const parsed = parseStandardDocument({
      nodes: doc.nodes,
      links: [
        { id: 'ok', from: role.id, to: scene.id },
        { id: 'ghost', from: role.id, to: 'nope' },
        { id: 'self', from: role.id, to: role.id },
      ],
    });
    assert.deepEqual(parsed.links.map((link) => link.id), ['ok']);
  });

  test('clamps the zoom into a usable range', () => {
    assert.equal(parseStandardDocument({ viewport: { zoom: 99 } }).viewport.zoom, 2.5);
    assert.equal(parseStandardDocument({ viewport: { zoom: 0.01 } }).viewport.zoom, 0.25);
  });

  test('falls back to the default document on rubbish', () => {
    assert.equal(parseStandardDocument('nonsense').nodes.length, 3);
    assert.equal(parseStandardDocument(null).nodes.length, 3);
  });

  test('keeps an empty node list rather than resurrecting defaults', () => {
    const parsed = parseStandardDocument({ nodes: [] });
    assert.equal(parsed.nodes.length, 0);
  });
});

describe('loadStandardDocument', () => {
  test('reads a serialized string', () => {
    const doc = createDefaultDocument();
    doc.composer.prompt = '雨夜街头';
    const loaded = loadStandardDocument(serializeStandardDocument(doc));
    assert.equal(loaded.composer.prompt, '雨夜街头');
  });

  test('an empty or broken string gives a fresh board', () => {
    assert.equal(loadStandardDocument('').nodes.length, 3);
    assert.equal(loadStandardDocument('{oops').nodes.length, 3);
    assert.equal(loadStandardDocument(undefined).nodes.length, 3);
  });
});

describe('ports and links', () => {
  test('ports sit on the vertical centre of each edge', () => {
    const node = createNode('role', { x: 100, y: 200 });
    assert.deepEqual(outputPort(node), { x: 100 + node.width, y: 200 + node.height / 2 });
    assert.deepEqual(inputPort(node), { x: 100, y: 200 + node.height / 2 });
  });

  test('the link path is a curve between the two ports', () => {
    const path = linkPath({ x: 0, y: 0 }, { x: 200, y: 100 });
    assert.ok(path.startsWith('M 0 0 C '));
    assert.ok(path.endsWith('200 100'));
  });
});
