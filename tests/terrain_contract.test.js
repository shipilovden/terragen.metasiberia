const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(html);
  assert(match, `function ${name} not found`);
  const start = match.index;
  const open = html.indexOf('{', start);
  let depth = 0;
  let state = 'code';
  let escaped = false;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    const next = html[i + 1];
    if (state === 'line') {
      if (ch === '\n') state = 'code';
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') { state = 'code'; i++; }
      continue;
    }
    if (state !== 'code') {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"') || (state === 'template' && ch === '`')) state = 'code';
      continue;
    }
    if (ch === '/' && next === '/') { state = 'line'; i++; continue; }
    if (ch === '/' && next === '*') { state = 'block'; i++; continue; }
    if (ch === "'") { state = 'single'; continue; }
    if (ch === '"') { state = 'double'; continue; }
    if (ch === '`') { state = 'template'; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function contextWithFunctions(names, values = {}) {
  const context = vm.createContext({...values});
  vm.runInContext(names.map(extractFunction).join('\n'), context);
  return context;
}

// Changing authoring resolution must preserve the categorical tree encoding:
// 128 = FORCE ADD, 255 = FORCE BLOCK.
{
  const G = 64;
  const treeMask = new Uint8ClampedArray(G * G);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) treeMask[y * G + x] = x < G / 2 ? 128 : 255;
  const maskRGB = new Uint8ClampedArray(G * G * 3);
  for (let i = 0; i < G * G; i++) maskRGB[i * 3 + 1] = 255;
  const context = contextWithFunctions(['clamp', 'lerp', 'bilinearField', 'normalizeMaterialPixel', 'resizeGrid'], {
    G,
    height: new Float32Array(G * G),
    autoRGB: new Uint8ClampedArray(G * G * 3),
    maskRGB,
    overrideA: new Uint8ClampedArray(G * G),
    treeMask,
    treeAutoMask: new Uint8ClampedArray(G * G),
    treeMaterialOverrideA: new Uint8ClampedArray(G * G),
    geoRoadMask: new Uint8ClampedArray(G * G),
    geoBuildingMask: new Uint8ClampedArray(G * G),
    snapshot() {},
    ctx: {createImageData(w, h) { return {width: w, height: h, data: new Uint8ClampedArray(w * h * 4)}; }},
    $() { return null; },
    refreshVisualPeak() {},
    generateAutoMask() {},
    buildAutomaticForestMask() { return new Uint8ClampedArray(context.G * context.G); },
    applyForestToMaterialMask() {},
    render2d() {},
    updateUndoButtons() {},
    updateMapSizeInfo() {}
  });
  context.resizeGrid(128);
  assert.equal(context.treeMask[10 * 128 + 10], 128);
  assert.equal(context.treeMask[10 * 128 + 120], 255);
  assert([...new Set(context.treeMask)].every(v => v === 0 || v === 128 || v === 255));
}

// The exported tree PNG must implement the same AND gate as the client.
{
  function makeCanvas() {
    const canvas = {width: 0, height: 0, image: null};
    canvas.getContext = () => ({
      createImageData(w, h) { return {width: w, height: h, data: new Uint8ClampedArray(w * h * 4)}; },
      putImageData(image) { canvas.image = image; },
      translate() {}, scale() {}, drawImage(source) { canvas.image = source.image; }
    });
    return canvas;
  }
  const context = contextWithFunctions(['clamp', 'terrainAxisScale', 'idx', 'exportSourceAt', 'minimumTreeHeight', 'treePermissionAt', 'canvasFromRGBData', 'buildTreeMaskCanvas'], {
    G: 2,
    OUT: 2,
    terrainAspect: 1,
    worldSize: 8192,
    height: new Float32Array([10, 10, 10, 10]),
    treeMask: new Uint8ClampedArray([128, 128, 128, 128]),
    treeAutoMask: new Uint8ClampedArray(4),
    document: {createElement() { return makeCanvas(); }},
    $(id) { return id === 'flipY' ? {checked: false} : {value: 0}; }
  });
  const material = new Uint8ClampedArray([
    0, 0, 255,
    0, 255, 0,
    0, 127, 128,
    0, 128, 127
  ]);
  const canvas = context.buildTreeMaskCanvas(material);
  const red = [0, 1, 2, 3].map(i => canvas.image.data[i * 4]);
  assert.deepEqual(red, [255, 0, 255, 0]);
  context.height[0] = 0;
  assert.equal(context.treePermissionAt(0, 0, 0), false, 'manual tree paint must not enable trees at or below water');
}

// Rectangular map selections must be padded into a square client section.
{
  const context = contextWithFunctions(['clamp', 'terrainAxisScale', 'exportSourceAt'], {G: 4, OUT: 4, terrainAspect: 2});
  assert.equal(context.exportSourceAt(1, 0, 4), null);
  assert(context.exportSourceAt(1, 1, 4));
  assert(context.exportSourceAt(1, 2, 4));
  assert.equal(context.exportSourceAt(1, 3, 4), null);
}

assert.match(html, /materialTool='r',treeTool='treeAdd'/);
assert.match(html, /if\(which==='mask'\)maskTool=materialTool;/);
assert.match(html, /else if\(which==='trees'\)maskTool=treeTool;/);
assert.match(html, /flipY:!!\$\('flipY'\)\.checked/);
assert.match(html, /terrainHeightScale:1/);

console.log('TerrainGen contract tests passed');
