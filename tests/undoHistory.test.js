import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPatternSnapshot,
  pushPatternSnapshot,
  restorePatternSnapshot,
} from '../src/pattern/undoHistory.js';

test('撤销会恢复最近一次修改前的图纸', () => {
  const pattern = { indices: new Uint8Array([1, 2, 3, 4]) };
  const history = [];
  pushPatternSnapshot(history, createPatternSnapshot(pattern));
  pattern.indices[1] = 9;
  pushPatternSnapshot(history, createPatternSnapshot(pattern));
  pattern.indices[2] = 8;

  assert.equal(restorePatternSnapshot(history, pattern), true);
  assert.deepEqual([...pattern.indices], [1, 9, 3, 4]);
  assert.equal(restorePatternSnapshot(history, pattern), true);
  assert.deepEqual([...pattern.indices], [1, 2, 3, 4]);
});

test('撤销历史会限制数量并忽略尺寸不匹配的旧图纸', () => {
  const history = [];
  for (let value = 1; value <= 4; value += 1) {
    pushPatternSnapshot(history, new Uint8Array([value]), 2);
  }
  assert.equal(history.length, 2);
  const differentPattern = { indices: new Uint8Array([1, 2]) };
  assert.equal(restorePatternSnapshot(history, differentPattern), false);
});
