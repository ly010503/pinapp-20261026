import test from 'node:test';
import assert from 'node:assert/strict';
import { replacePatternCell, replacePatternColor } from '../src/pattern/colorReplacement.js';

test('替换所有匹配颜色并保持网格总数不变', () => {
  const pattern = { indices: new Uint8Array([1, 2, 1, 3, 2]) };
  const replaced = replacePatternColor(pattern, 1, 2);

  assert.equal(replaced, 2);
  assert.deepEqual([...pattern.indices], [2, 2, 2, 3, 2]);
  assert.equal(pattern.indices.length, 5);
});

test('源颜色和目标颜色相同时不修改图纸', () => {
  const pattern = { indices: new Uint8Array([1, 1]) };

  assert.equal(replacePatternColor(pattern, 1, 1), 0);
  assert.deepEqual([...pattern.indices], [1, 1]);
});

test('只替换用户点击的单个格子', () => {
  const pattern = { indices: new Uint8Array([1, 1, 1, 1]) };

  assert.equal(replacePatternCell(pattern, 2, 7), true);
  assert.deepEqual([...pattern.indices], [1, 1, 7, 1]);
  assert.equal(replacePatternCell(pattern, 2, 7), false);
});
