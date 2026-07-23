import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('通用色卡包含 48 个唯一且一致的颜色', async () => {
  const url=new URL('../src/data/palettes/universal-48.json',import.meta.url);
  const palette=JSON.parse(await readFile(url,'utf8'));
  assert.equal(palette.length,48);
  assert.equal(new Set(palette.map((item)=>item.code)).size,48);
  for(const color of palette){
    assert.match(color.hex,/^#[0-9A-F]{6}$/i);
    const hex=`#${color.rgb.map((value)=>value.toString(16).padStart(2,'0')).join('')}`.toUpperCase();
    assert.equal(color.hex.toUpperCase(),hex);
  }
});
