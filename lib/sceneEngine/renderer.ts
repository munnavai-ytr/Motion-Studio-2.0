import type {
  Scene,
  SceneLayer,
  Keyframe,
  TextLayer,
  RectLayer,
  RoundedRectLayer,
  CircleLayer,
  LineLayer,
  ImageLayer,
  GroupLayer,
} from '../types.ts';
import { interpolateColor, interpolateNumber } from './easing.ts';

export type AnyCanvasContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

/**
 * Computes the interpolated value of a property at time t from a list of keyframes.
 */
export function getInterpolatedProp<T = any>(
  keyframes: Keyframe[] | undefined,
  property: string,
  defaultValue: T,
  t: number
): T {
  if (!keyframes || keyframes.length === 0) return defaultValue;

  const propKeyframes = keyframes
    .filter((k) => k.property === property)
    .sort((a, b) => a.time - b.time);

  if (propKeyframes.length === 0) return defaultValue;

  // Before first keyframe
  if (t <= propKeyframes[0].time) {
    return propKeyframes[0].value as unknown as T;
  }

  // After last keyframe
  const last = propKeyframes[propKeyframes.length - 1];
  if (t >= last.time) {
    return last.value as unknown as T;
  }

  // Find surrounding keyframes
  for (let i = 0; i < propKeyframes.length - 1; i++) {
    const k1 = propKeyframes[i];
    const k2 = propKeyframes[i + 1];
    if (t >= k1.time && t <= k2.time) {
      const duration = k2.time - k1.time;
      const progress = duration > 0 ? (t - k1.time) / duration : 1;
      const easing = k2.easing || 'ease-out';

      // Numeric interpolation
      if (typeof k1.value === 'number' && typeof k2.value === 'number') {
        return interpolateNumber(k1.value, k2.value, progress, easing) as unknown as T;
      }

      // Color interpolation (hex string)
      if (
        typeof k1.value === 'string' &&
        typeof k2.value === 'string' &&
        (k1.value.startsWith('#') || k1.value.startsWith('rgb')) &&
        (k2.value.startsWith('#') || k2.value.startsWith('rgb'))
      ) {
        return interpolateColor(k1.value, k2.value, progress, easing) as unknown as T;
      }

      // Discrete interpolation
      return (progress < 0.5 ? k1.value : k2.value) as unknown as T;
    }
  }

  return defaultValue;
}

/**
 * Pure deterministic renderer for Motion Studio scenes.
 * Renders a scene at time t directly to any 2D canvas context.
 * No Date.now(), Math.random(), or asynchronous calls inside.
 */
export function renderScene(
  scene: Scene,
  t: number,
  ctx: AnyCanvasContext,
  imageCache?: Map<string, CanvasImageSource>
): void {
  const { width, height, background } = scene.canvas;

  // Clear canvas & draw background
  ctx.save();
  ctx.fillStyle = background || '#0F1115';
  ctx.fillRect(0, 0, width, height);

  // Render tracks
  for (const layer of scene.tracks) {
    renderLayer(layer, t, ctx, imageCache);
  }

  ctx.restore();
}

function renderLayer(
  layer: SceneLayer,
  t: number,
  ctx: AnyCanvasContext,
  imageCache?: Map<string, CanvasImageSource>
): void {
  const kf = layer.keyframes;

  // Interpolated transform values
  const x = getInterpolatedProp<number>(kf, 'x', layer.x ?? 0, t);
  const y = getInterpolatedProp<number>(kf, 'y', layer.y ?? 0, t);
  const rotation = getInterpolatedProp<number>(kf, 'rotation', layer.rotation ?? 0, t);
  const scaleX = getInterpolatedProp<number>(kf, 'scaleX', layer.scaleX ?? 1, t);
  const scaleY = getInterpolatedProp<number>(kf, 'scaleY', layer.scaleY ?? 1, t);
  const opacity = Math.max(0, Math.min(1, getInterpolatedProp<number>(kf, 'opacity', layer.opacity ?? 1, t)));

  if (opacity <= 0 || scaleX === 0 || scaleY === 0) {
    return; // Invisible, skip
  }

  ctx.save();
  ctx.translate(x, y);
  if (rotation !== 0) {
    ctx.rotate((rotation * Math.PI) / 180);
  }
  if (scaleX !== 1 || scaleY !== 1) {
    ctx.scale(scaleX, scaleY);
  }
  ctx.globalAlpha *= opacity;

  // Render specific layer type
  switch (layer.type) {
    case 'text':
      renderTextLayer(layer as TextLayer, t, ctx);
      break;
    case 'rect':
      renderRectLayer(layer as RectLayer, t, ctx);
      break;
    case 'rounded-rect':
      renderRoundedRectLayer(layer as RoundedRectLayer, t, ctx);
      break;
    case 'circle':
      renderCircleLayer(layer as CircleLayer, t, ctx);
      break;
    case 'line':
      renderLineLayer(layer as LineLayer, t, ctx);
      break;
    case 'image':
      renderImageLayer(layer as ImageLayer, t, ctx, imageCache);
      break;
    case 'group':
      renderGroupLayer(layer as GroupLayer, t, ctx, imageCache);
      break;
  }

  ctx.restore();
}

function renderTextLayer(layer: TextLayer, t: number, ctx: AnyCanvasContext): void {
  const kf = layer.keyframes;
  const fontSize = getInterpolatedProp<number>(kf, 'fontSize', layer.fontSize ?? 48, t);
  const color = getInterpolatedProp<string>(kf, 'color', layer.color ?? '#FFFFFF', t);
  const fontFamily = layer.fontFamily || "'Geist', 'Hind Siliguri', sans-serif";
  const fontWeight = layer.fontWeight || 600;
  const align = layer.align || 'center';

  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';

  let displayText = layer.text;

  // Stagger reveal logic (letter / word / line)
  if (layer.stagger) {
    const startTime = layer.stagger.startTime ?? 0;
    const dur = layer.stagger.duration;
    if (t < startTime) {
      displayText = '';
    } else if (t < startTime + dur && dur > 0) {
      const progress = (t - startTime) / dur;
      if (layer.stagger.mode === 'letter') {
        const chars = Array.from(layer.text);
        const count = Math.max(0, Math.floor(progress * chars.length));
        displayText = chars.slice(0, count).join('');
      } else if (layer.stagger.mode === 'word') {
        const words = layer.text.split(' ');
        const count = Math.max(0, Math.floor(progress * words.length));
        displayText = words.slice(0, count).join(' ');
      } else if (layer.stagger.mode === 'line') {
        const lines = layer.text.split('\n');
        const count = Math.max(0, Math.floor(progress * lines.length));
        displayText = lines.slice(0, count).join('\n');
      }
    }
  }

  if (!displayText) return;

  const anchorX = layer.anchorX ?? (align === 'center' ? 0 : align === 'right' ? 1 : 0);
  const anchorY = layer.anchorY ?? 0;

  // Multi-line support
  const lines = displayText.split('\n');
  const lineHeight = layer.lineHeight ? layer.lineHeight * fontSize : fontSize * 1.3;
  const totalHeight = (lines.length - 1) * lineHeight;

  lines.forEach((line, index) => {
    const lineY = -anchorY * totalHeight + (index - (lines.length - 1) / 2) * lineHeight;
    ctx.fillText(line, -anchorX, lineY);
  });
}

function renderRectLayer(layer: RectLayer, t: number, ctx: AnyCanvasContext): void {
  const kf = layer.keyframes;
  const width = getInterpolatedProp<number>(kf, 'width', layer.width, t);
  const height = getInterpolatedProp<number>(kf, 'height', layer.height, t);
  const fill = getInterpolatedProp<string>(kf, 'fill', layer.fill ?? '#FF5B3A', t);
  const stroke = getInterpolatedProp<string | undefined>(kf, 'stroke', layer.stroke, t);
  const strokeWidth = getInterpolatedProp<number>(kf, 'strokeWidth', layer.strokeWidth ?? 0, t);

  const anchorX = layer.anchorX ?? 0.5;
  const anchorY = layer.anchorY ?? 0.5;
  const drawX = -anchorX * width;
  const drawY = -anchorY * height;

  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(drawX, drawY, width, height);
  }

  if (stroke && strokeWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.strokeRect(drawX, drawY, width, height);
  }
}

function renderRoundedRectLayer(layer: RoundedRectLayer, t: number, ctx: AnyCanvasContext): void {
  const kf = layer.keyframes;
  const width = getInterpolatedProp<number>(kf, 'width', layer.width, t);
  const height = getInterpolatedProp<number>(kf, 'height', layer.height, t);
  const radius = getInterpolatedProp<number>(kf, 'radius', layer.radius, t);
  const fill = getInterpolatedProp<string>(kf, 'fill', layer.fill ?? '#181B21', t);
  const stroke = getInterpolatedProp<string | undefined>(kf, 'stroke', layer.stroke, t);
  const strokeWidth = getInterpolatedProp<number>(kf, 'strokeWidth', layer.strokeWidth ?? 0, t);

  const anchorX = layer.anchorX ?? 0.5;
  const anchorY = layer.anchorY ?? 0.5;
  const drawX = -anchorX * width;
  const drawY = -anchorY * height;

  ctx.beginPath();
  if (typeof (ctx as any).roundRect === 'function') {
    (ctx as any).roundRect(drawX, drawY, width, height, Math.max(0, radius));
  } else {
    // Pure fallback for environments without roundRect
    const r = Math.min(radius, width / 2, height / 2);
    ctx.moveTo(drawX + r, drawY);
    ctx.lineTo(drawX + width - r, drawY);
    ctx.quadraticCurveTo(drawX + width, drawY, drawX + width, drawY + r);
    ctx.lineTo(drawX + width, drawY + height - r);
    ctx.quadraticCurveTo(drawX + width, drawY + height, drawX + width - r, drawY + height);
    ctx.lineTo(drawX + r, drawY + height);
    ctx.quadraticCurveTo(drawX, drawY + height, drawX, drawY + height - r);
    ctx.lineTo(drawX, drawY + r);
    ctx.quadraticCurveTo(drawX, drawY, drawX + r, drawY);
    ctx.closePath();
  }

  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }

  if (stroke && strokeWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
}

function renderCircleLayer(layer: CircleLayer, t: number, ctx: AnyCanvasContext): void {
  const kf = layer.keyframes;
  const radius = getInterpolatedProp<number>(kf, 'radius', layer.radius, t);
  const fill = getInterpolatedProp<string>(kf, 'fill', layer.fill ?? '#FF5B3A', t);
  const stroke = getInterpolatedProp<string | undefined>(kf, 'stroke', layer.stroke, t);
  const strokeWidth = getInterpolatedProp<number>(kf, 'strokeWidth', layer.strokeWidth ?? 0, t);

  ctx.beginPath();
  ctx.arc(0, 0, Math.max(0, radius), 0, Math.PI * 2);

  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }

  if (stroke && strokeWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
}

function renderLineLayer(layer: LineLayer, t: number, ctx: AnyCanvasContext): void {
  const kf = layer.keyframes;
  const x2 = getInterpolatedProp<number>(kf, 'x2', layer.x2, t);
  const y2 = getInterpolatedProp<number>(kf, 'y2', layer.y2, t);
  const stroke = getInterpolatedProp<string>(kf, 'stroke', layer.stroke, t);
  const strokeWidth = getInterpolatedProp<number>(kf, 'strokeWidth', layer.strokeWidth, t);

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = layer.lineCap || 'round';
  ctx.stroke();
}

function renderImageLayer(
  layer: ImageLayer,
  t: number,
  ctx: AnyCanvasContext,
  imageCache?: Map<string, CanvasImageSource>
): void {
  const kf = layer.keyframes;
  const width = getInterpolatedProp<number>(kf, 'width', layer.width, t);
  const height = getInterpolatedProp<number>(kf, 'height', layer.height, t);
  const anchorX = layer.anchorX ?? 0.5;
  const anchorY = layer.anchorY ?? 0.5;
  const drawX = -anchorX * width;
  const drawY = -anchorY * height;

  const cachedImg = imageCache?.get(layer.src);
  if (cachedImg) {
    ctx.drawImage(cachedImg, drawX, drawY, width, height);
  } else {
    // Deterministic fallback placeholder for images not yet cached
    ctx.fillStyle = '#262A33';
    ctx.fillRect(drawX, drawY, width, height);
    ctx.strokeStyle = '#474D5A';
    ctx.lineWidth = 2;
    ctx.strokeRect(drawX, drawY, width, height);
  }
}

function renderGroupLayer(
  layer: GroupLayer,
  t: number,
  ctx: AnyCanvasContext,
  imageCache?: Map<string, CanvasImageSource>
): void {
  for (const child of layer.children) {
    renderLayer(child, t, ctx, imageCache);
  }
}
