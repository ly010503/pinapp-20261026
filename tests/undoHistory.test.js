import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPatternSnapshot,
  createPatternStateSnapshot,
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

test('完整快照可以撤销图纸尺寸调整并恢复尺寸和采样数据', () => {
  const pattern = {
    width: 3,
    height: 2,
    indices: new Uint8Array([1, 2, 3, 4, 5, 6]),
    sourcePixels: new Uint8ClampedArray(24).fill(9),
    backgroundMask: new Uint8Array([1, 0, 0, 0, 0, 1]),
  };
  const history = [];
  pushPatternSnapshot(history, createPatternStateSnapshot(pattern));
  Object.assign(pattern, {
    width: 2,
    height: 2,
    indices: new Uint8Array([2, 3, 5, 6]),
    sourcePixels: new Uint8ClampedArray(16).fill(3),
    backgroundMask: new Uint8Array(4),
  });

  assert.equal(restorePatternSnapshot(history, pattern), true);
  assert.equal(pattern.width, 3);
  assert.equal(pattern.height, 2);
  assert.deepEqual([...pattern.indices], [1, 2, 3, 4, 5, 6]);
  assert.equal(pattern.sourcePixels.length, 24);
  assert.deepEqual([...pattern.backgroundMask], [1, 0, 0, 0, 0, 1]);
});
