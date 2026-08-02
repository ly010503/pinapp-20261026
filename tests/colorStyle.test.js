import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLOR_STYLES,
  getColorStyleAdjustments,
  shouldProtectDarkOutline,
} from '../src/image/colorStyle.js';

test('鲜艳模式提高饱和度和少量对比度', () => {
  const base = { brightness: 0, contrast: 0, saturation: 0, sharpen: 10 };
  const natural = getColorStyleAdjustments(base, 'natural');
  const vivid = getColorStyleAdjustments(base, 'vivid');
  assert.equal(natural.saturation, 0);
  assert.ok(vivid.saturation > natural.saturation);
  assert.ok(vivid.contrast > natural.contrast);
  assert.equal(vivid.sharpen, 10);
});

test('原色识别不改变识别颜色，也不会强制强化黑色轮廓', () => {
  const base = { brightness: 8, contrast: -4, saturation: 12, sharpen: 10 };
  const direct = getColorStyleAdjustments(base, 'direct');
  assert.equal(direct.brightness, 0);
  assert.equal(direct.contrast, 0);
  assert.equal(direct.saturation, 0);
  assert.equal(direct.sharpen, 10);
  assert.equal(shouldProtectDarkOutline('direct'), false);
  assert.equal(shouldProtectDarkOutline('natural'), true);
  assert.equal(shouldProtectDarkOutline('vivid'), true);
});

test('自然和鲜艳模式的原有参数保持不变', () => {
  assert.deepEqual(COLOR_STYLES.natural, { brightness: 0, contrast: 0, saturation: 0 });
  assert.deepEqual(COLOR_STYLES.vivid, { brightness: 1, contrast: 10, saturation: 65 });
});
