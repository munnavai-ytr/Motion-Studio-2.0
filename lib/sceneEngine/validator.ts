import type { Scene, SceneLayer, Keyframe } from '../types.ts';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  scene?: Scene;
}

export function validateScene(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['Scene must be a valid JSON object'] };
  }

  const obj = input as Record<string, any>;

  // 1. Validate Canvas
  if (!obj.canvas || typeof obj.canvas !== 'object') {
    errors.push('Missing "canvas" configuration object');
  } else {
    const c = obj.canvas;
    if (typeof c.width !== 'number' || c.width <= 0 || c.width > 4096) {
      errors.push('Canvas "width" must be a positive number between 1 and 4096');
    }
    if (typeof c.height !== 'number' || c.height <= 0 || c.height > 4096) {
      errors.push('Canvas "height" must be a positive number between 1 and 4096');
    }
    if (typeof c.fps !== 'number' || c.fps <= 0 || c.fps > 120) {
      errors.push('Canvas "fps" must be a positive number between 1 and 120');
    }
    if (typeof c.duration !== 'number' || c.duration <= 0 || c.duration > 3600) {
      errors.push('Canvas "duration" must be a positive number between 0.1 and 3600 seconds');
    }
    if (typeof c.background !== 'string' || c.background.trim() === '') {
      errors.push('Canvas "background" must be a valid color string');
    }
  }

  // 2. Validate Tracks
  if (!Array.isArray(obj.tracks)) {
    errors.push('"tracks" must be an array of layers');
  } else {
    obj.tracks.forEach((layer: any, idx: number) => {
      validateLayer(layer, `tracks[${idx}]`, errors);
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], scene: obj as Scene };
}

function validateLayer(layer: any, path: string, errors: string[]) {
  if (!layer || typeof layer !== 'object') {
    errors.push(`${path}: layer must be an object`);
    return;
  }

  if (typeof layer.id !== 'string' || layer.id.trim() === '') {
    errors.push(`${path}: layer must have a non-empty "id" string`);
  }

  const validTypes = ['text', 'rect', 'rounded-rect', 'circle', 'line', 'image', 'group'];
  if (!validTypes.includes(layer.type)) {
    errors.push(`${path}: invalid layer type "${layer.type}". Expected one of: ${validTypes.join(', ')}`);
    return;
  }

  // Type-specific validation
  switch (layer.type) {
    case 'text':
      if (typeof layer.text !== 'string') {
        errors.push(`${path}: text layer must have a "text" string`);
      }
      break;
    case 'rect':
      if (typeof layer.width !== 'number' || typeof layer.height !== 'number') {
        errors.push(`${path}: rect layer must have numeric "width" and "height"`);
      }
      break;
    case 'rounded-rect':
      if (typeof layer.width !== 'number' || typeof layer.height !== 'number' || typeof layer.radius !== 'number') {
        errors.push(`${path}: rounded-rect layer must have numeric "width", "height", and "radius"`);
      }
      break;
    case 'circle':
      if (typeof layer.radius !== 'number' || layer.radius <= 0) {
        errors.push(`${path}: circle layer must have a positive numeric "radius"`);
      }
      break;
    case 'line':
      if (typeof layer.x2 !== 'number' || typeof layer.y2 !== 'number') {
        errors.push(`${path}: line layer must have numeric "x2" and "y2"`);
      }
      break;
    case 'image':
      if (typeof layer.src !== 'string' || layer.src.trim() === '') {
        errors.push(`${path}: image layer must have a valid "src" string`);
      }
      break;
    case 'group':
      if (!Array.isArray(layer.children)) {
        errors.push(`${path}: group layer must have a "children" array`);
      } else {
        layer.children.forEach((child: any, cIdx: number) => {
          validateLayer(child, `${path}.children[${cIdx}]`, errors);
        });
      }
      break;
  }

  // Validate Keyframes if present
  if (layer.keyframes !== undefined) {
    if (!Array.isArray(layer.keyframes)) {
      errors.push(`${path}: "keyframes" must be an array`);
    } else {
      layer.keyframes.forEach((kf: any, kIdx: number) => {
        validateKeyframe(kf, `${path}.keyframes[${kIdx}]`, errors);
      });
    }
  }
}

function validateKeyframe(kf: any, path: string, errors: string[]) {
  if (!kf || typeof kf !== 'object') {
    errors.push(`${path}: keyframe must be an object`);
    return;
  }
  if (typeof kf.time !== 'number' || kf.time < 0) {
    errors.push(`${path}: keyframe "time" must be a non-negative number`);
  }
  if (typeof kf.property !== 'string' || kf.property.trim() === '') {
    errors.push(`${path}: keyframe "property" must be a non-empty string`);
  }
  if (kf.value === undefined) {
    errors.push(`${path}: keyframe "value" must be defined`);
  }
}
