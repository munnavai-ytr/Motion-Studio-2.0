import type { EasingType } from '../types.ts';

/**
 * Pure easing functions mapping time progress x in [0, 1] to animated progress.
 */
export function linear(x: number): number {
  return x;
}

export function easeIn(x: number): number {
  return x * x * x;
}

export function easeOut(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

export function easeInOut(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function back(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

export function spring(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Damped harmonic oscillation with gentle settle
  const decay = Math.exp(-6 * x);
  const oscillation = Math.cos(x * Math.PI * 4);
  return 1 - decay * oscillation;
}

export function applyEasing(t: number, type?: EasingType): number {
  const clamped = Math.max(0, Math.min(1, t));
  switch (type) {
    case 'linear':
      return linear(clamped);
    case 'ease-in':
      return easeIn(clamped);
    case 'ease-out':
      return easeOut(clamped);
    case 'ease-in-out':
      return easeInOut(clamped);
    case 'back':
      return back(clamped);
    case 'spring':
      return spring(clamped);
    default:
      return easeOut(clamped);
  }
}

/**
 * Interpolates between two numbers or numeric strings using easing.
 */
export function interpolateNumber(
  start: number,
  end: number,
  progress: number,
  easing?: EasingType
): number {
  const eased = applyEasing(progress, easing);
  return start + (end - start) * eased;
}

/**
 * Interpolates hex colors #RRGGBB or #RGB.
 */
export function interpolateColor(
  startHex: string,
  endHex: string,
  progress: number,
  easing?: EasingType
): string {
  const parseHex = (h: string) => {
    let clean = h.replace('#', '');
    if (clean.length === 3) {
      clean = clean.split('').map((c) => c + c).join('');
    }
    const num = parseInt(clean, 16);
    return [
      (num >> 16) & 255,
      (num >> 8) & 255,
      num & 255,
    ];
  };

  try {
    const [r1, g1, b1] = parseHex(startHex);
    const [r2, g2, b2] = parseHex(endHex);
    const r = Math.round(interpolateNumber(r1, r2, progress, easing));
    const g = Math.round(interpolateNumber(g1, g2, progress, easing));
    const b = Math.round(interpolateNumber(b1, b2, progress, easing));
    return `rgb(${Math.max(0, Math.min(255, r))}, ${Math.max(0, Math.min(255, g))}, ${Math.max(0, Math.min(255, b))})`;
  } catch {
    return progress < 0.5 ? startHex : endHex;
  }
}
