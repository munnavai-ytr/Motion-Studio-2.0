import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { validateScene } from '../lib/sceneEngine/validator.ts';
import { SAMPLE_TEMPLATES } from '../lib/sceneEngine/templates.ts';
import {
  linear,
  easeIn,
  easeOut,
  easeInOut,
  back,
  spring,
  applyEasing,
  interpolateNumber,
  interpolateColor,
} from '../lib/sceneEngine/easing.ts';
import { renderScene, getInterpolatedProp } from '../lib/sceneEngine/renderer.ts';
import { formatBytes, checkDeviceCapabilities } from '../lib/deviceCheck.ts';
import type { Scene } from '../lib/types.ts';

// -----------------------------------------------------------------------------
// TEST SUITE 1: Scene Validation
// -----------------------------------------------------------------------------
test('Scene Validation: All 3 sample templates pass validation', () => {
  for (const tpl of SAMPLE_TEMPLATES) {
    const res = validateScene(tpl);
    assert.equal(res.valid, true, `Template "${tpl.name}" should be valid`);
    assert.equal(res.errors.length, 0);
    assert.ok(res.scene);
  }
});

test('Scene Validation: Rejects invalid canvas configurations', () => {
  const missingCanvas = { tracks: [] };
  const res1 = validateScene(missingCanvas);
  assert.equal(res1.valid, false);
  assert.ok(res1.errors.some((e) => e.includes('Missing "canvas"')));

  const negativeDimensions = {
    canvas: { width: -100, height: 1080, fps: 30, duration: 4, background: '#000' },
    tracks: [],
  };
  const res2 = validateScene(negativeDimensions);
  assert.equal(res2.valid, false);
  assert.ok(res2.errors.some((e) => e.includes('Canvas "width"')));

  const invalidFps = {
    canvas: { width: 1920, height: 1080, fps: -5, duration: 4, background: '#000' },
    tracks: [],
  };
  const res3 = validateScene(invalidFps);
  assert.equal(res3.valid, false);
  assert.ok(res3.errors.some((e) => e.includes('Canvas "fps"')));
});

test('Scene Validation: Rejects invalid layers and missing required fields', () => {
  const badLayerType = {
    canvas: { width: 1920, height: 1080, fps: 30, duration: 4, background: '#000' },
    tracks: [{ id: 'l1', name: 'Bad', type: 'three-d-mesh' }],
  };
  const res1 = validateScene(badLayerType);
  assert.equal(res1.valid, false);
  assert.ok(res1.errors.some((e) => e.includes('invalid layer type')));

  const badTextLayer = {
    canvas: { width: 1920, height: 1080, fps: 30, duration: 4, background: '#000' },
    tracks: [{ id: 't1', name: 'Title', type: 'text' }], // missing text property
  };
  const res2 = validateScene(badTextLayer);
  assert.equal(res2.valid, false);
  assert.ok(res2.errors.some((e) => e.includes('text layer must have a "text" string')));

  const badCircleLayer = {
    canvas: { width: 1920, height: 1080, fps: 30, duration: 4, background: '#000' },
    tracks: [{ id: 'c1', name: 'Circle', type: 'circle', radius: -10 }],
  };
  const res3 = validateScene(badCircleLayer);
  assert.equal(res3.valid, false);
  assert.ok(res3.errors.some((e) => e.includes('positive numeric "radius"')));
});

test('Scene Validation: Rejects invalid keyframes', () => {
  const badKeyframe = {
    canvas: { width: 1920, height: 1080, fps: 30, duration: 4, background: '#000' },
    tracks: [
      {
        id: 'r1',
        name: 'Rect',
        type: 'rect',
        width: 100,
        height: 100,
        keyframes: [{ time: -1, property: 'x', value: 50 }],
      },
    ],
  };
  const res = validateScene(badKeyframe);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes('non-negative number')));
});

// -----------------------------------------------------------------------------
// TEST SUITE 2: Easing Functions & Interpolation
// -----------------------------------------------------------------------------
test('Easing Functions: Boundary conditions and monotonicity', () => {
  assert.equal(linear(0), 0);
  assert.equal(linear(1), 1);
  assert.equal(linear(0.5), 0.5);

  assert.equal(easeIn(0), 0);
  assert.equal(easeIn(1), 1);
  assert.ok(easeIn(0.5) < 0.5);

  assert.equal(easeOut(0), 0);
  assert.equal(easeOut(1), 1);
  assert.ok(easeOut(0.5) > 0.5);

  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.equal(easeInOut(0.5), 0.5);

  // Back easing overshoots 1 and returns to 1
  assert.equal(back(0), 0);
  assert.equal(Math.round(back(1)), 1);
  assert.ok(back(0.85) > 1, 'Back easing should overshoot 1');

  // Spring damping starts at 0 and ends at 1
  assert.equal(spring(0), 0);
  assert.equal(spring(1), 1);
});

test('Interpolation: Numeric values and hex colors', () => {
  const num = interpolateNumber(100, 200, 0.5, 'linear');
  assert.equal(num, 150);

  const col = interpolateColor('#000000', '#FFFFFF', 0.5, 'linear');
  assert.equal(col, 'rgb(128, 128, 128)');
});

// -----------------------------------------------------------------------------
// TEST SUITE 3: Deterministic Scene Rendering
// -----------------------------------------------------------------------------
test('Deterministic Rendering: Exactly identical draw commands across multiple calls', () => {
  function createMockContext() {
    const commands: string[] = [];
    return {
      commands,
      save: () => commands.push('save'),
      restore: () => commands.push('restore'),
      translate: (x: number, y: number) => commands.push(`translate(${x.toFixed(2)},${y.toFixed(2)})`),
      rotate: (rad: number) => commands.push(`rotate(${rad.toFixed(4)})`),
      scale: (x: number, y: number) => commands.push(`scale(${x.toFixed(2)},${y.toFixed(2)})`),
      fillRect: (x: number, y: number, w: number, h: number) =>
        commands.push(`fillRect(${x.toFixed(2)},${y.toFixed(2)},${w.toFixed(2)},${h.toFixed(2)})`),
      strokeRect: (x: number, y: number, w: number, h: number) =>
        commands.push(`strokeRect(${x.toFixed(2)},${y.toFixed(2)},${w.toFixed(2)},${h.toFixed(2)})`),
      fillText: (text: string, x: number, y: number) =>
        commands.push(`fillText("${text}",${x.toFixed(2)},${y.toFixed(2)})`),
      beginPath: () => commands.push('beginPath'),
      arc: (x: number, y: number, r: number) => commands.push(`arc(${x.toFixed(2)},${y.toFixed(2)},${r.toFixed(2)})`),
      moveTo: (x: number, y: number) => commands.push(`moveTo(${x.toFixed(2)},${y.toFixed(2)})`),
      lineTo: (x: number, y: number) => commands.push(`lineTo(${x.toFixed(2)},${y.toFixed(2)})`),
      quadraticCurveTo: (cpx: number, cpy: number, x: number, y: number) =>
        commands.push(`quadraticCurveTo(${cpx.toFixed(2)},${cpy.toFixed(2)},${x.toFixed(2)},${y.toFixed(2)})`),
      fill: () => commands.push('fill'),
      stroke: () => commands.push('stroke'),
      closePath: () => commands.push('closePath'),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      globalAlpha: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
    } as any;
  }

  const scene = SAMPLE_TEMPLATES[0]; // Title Card
  const ctx1 = createMockContext();
  const ctx2 = createMockContext();

  renderScene(scene, 1.5, ctx1);
  renderScene(scene, 1.5, ctx2);

  assert.equal(ctx1.commands.length, ctx2.commands.length);
  assert.deepEqual(ctx1.commands, ctx2.commands, 'Rendered frame commands must be 100% deterministic');
});

test('Deterministic Rendering: Keyframe property interpolation at exact timestamps', () => {
  const kf = [
    { time: 0, property: 'x', value: 0 },
    { time: 1, property: 'x', value: 100, easing: 'linear' as const },
    { time: 2, property: 'x', value: 200, easing: 'linear' as const },
  ];

  assert.equal(getInterpolatedProp(kf, 'x', 0, 0), 0);
  assert.equal(getInterpolatedProp(kf, 'x', 0, 0.5), 50);
  assert.equal(getInterpolatedProp(kf, 'x', 0, 1.0), 100);
  assert.equal(getInterpolatedProp(kf, 'x', 0, 1.5), 150);
  assert.equal(getInterpolatedProp(kf, 'x', 0, 2.5), 200); // clamps after last
});

// -----------------------------------------------------------------------------
// TEST SUITE 4: Module Manifest & SHA-256 Verification
// -----------------------------------------------------------------------------
test('Modules Manifest: Exact file sizes and matching SHA-256 hashes', () => {
  const manifestPath = path.resolve(process.cwd(), 'public/modules.json');
  assert.ok(fs.existsSync(manifestPath), 'public/modules.json must exist');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.modules.length, 3);

  const expectedIds = ['render-core', 'scene-engine', 'fonts'];
  assert.deepEqual(manifest.modules.map((m: any) => m.id), expectedIds);

  // Check each file on disk against the manifest hash and size
  for (const mod of manifest.modules) {
    for (const file of mod.files) {
      const realPath = path.resolve(process.cwd(), 'public', file.path);
      assert.ok(fs.existsSync(realPath), `Bundle file ${file.path} must exist`);

      const fileBuffer = fs.readFileSync(realPath);
      assert.equal(fileBuffer.byteLength, file.sizeBytes, `File size of ${file.path} must match manifest exactly`);

      const computedHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      assert.equal(computedHash, file.sha256, `SHA-256 of ${file.path} must match manifest exactly`);
    }
  }
});

test('Modules Manifest: Corrupt buffer is rejected by checksum', () => {
  const dummyBuffer = Buffer.from('console.log("tampered or corrupt module file")');
  const originalHash = '206b654c03f0b8ad90f54a15395c0996177ecfc87845a6692a70ab4ab2e5e357';
  const corruptHash = crypto.createHash('sha256').update(dummyBuffer).digest('hex');

  assert.notEqual(corruptHash, originalHash, 'Tampered buffer hash must not match expected hash');
});

// -----------------------------------------------------------------------------
// TEST SUITE 5: Utilities & Device Capabilities
// -----------------------------------------------------------------------------
test('Device Check Utilities: formatBytes renders human readable sizes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1048576), '1.0 MB');
  assert.equal(formatBytes(1073741824), '1.0 GB');
});

test('Device Check: checkDeviceCapabilities runs safely without crashing in Node', async () => {
  const result = await checkDeviceCapabilities();
  assert.ok(result);
  assert.ok(['webcodecs-h264', 'mediarecorder-fallback', 'unsupported'].includes(result.recommendedRenderPath));
  assert.ok(result.checkedAt > 0);
});
