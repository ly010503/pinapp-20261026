import test from 'node:test';
import assert from 'node:assert/strict';
import { getColorStyleAdjustments } from '../src/image/colorStyle.js';

test('鲜艳模式提高饱和度和少量对比度', () => {
  const base = { brightness: 0, contrast: 0, saturation: 0, sharpen: 10 };
  const natural = getColorStyleAdjustments(base, 'natural');
  const vivid = getColorStyleAdjustments(base, 'vivid');
  assert.equal(natural.saturation, 0);
  assert.ok(vivid.saturation > natural.saturation);
  assert.ok(vivid.contrast > natural.contrast);
  assert.equal(vivid.sharpen, 10);
});
