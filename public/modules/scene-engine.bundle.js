/**
 * Motion Studio - Scene Engine Module v1.0.0
 * Deterministic Canvas 2D Animation Renderer & Validator
 */
(function(global) {
  function linear(x) { return x; }
  function easeIn(x) { return x * x * x; }
  function easeOut(x) { return 1 - Math.pow(1 - x, 3); }
  function easeInOut(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function back(x) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }
  function spring(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return 1 - Math.exp(-6 * x) * Math.cos(x * Math.PI * 4);
  }

  function applyEasing(t, type) {
    const clamped = Math.max(0, Math.min(1, t));
    switch (type) {
      case 'linear': return linear(clamped);
      case 'ease-in': return easeIn(clamped);
      case 'ease-out': return easeOut(clamped);
      case 'ease-in-out': return easeInOut(clamped);
      case 'back': return back(clamped);
      case 'spring': return spring(clamped);
      default: return easeOut(clamped);
    }
  }

  function interpolateNumber(start, end, progress, easing) {
    return start + (end - start) * applyEasing(progress, easing);
  }

  function getInterpolatedProp(keyframes, property, defaultValue, t) {
    if (!keyframes || keyframes.length === 0) return defaultValue;
    const pk = keyframes.filter(k => k.property === property).sort((a, b) => a.time - b.time);
    if (pk.length === 0) return defaultValue;
    if (t <= pk[0].time) return pk[0].value;
    if (t >= pk[pk.length - 1].time) return pk[pk.length - 1].value;
    for (let i = 0; i < pk.length - 1; i++) {
      const k1 = pk[i];
      const k2 = pk[i + 1];
      if (t >= k1.time && t <= k2.time) {
        const dur = k2.time - k1.time;
        const prog = dur > 0 ? (t - k1.time) / dur : 1;
        if (typeof k1.value === 'number' && typeof k2.value === 'number') {
          return interpolateNumber(k1.value, k2.value, prog, k2.easing);
        }
        return prog < 0.5 ? k1.value : k2.value;
      }
    }
    return defaultValue;
  }

  function renderScene(scene, t, ctx, imageCache) {
    const { width, height, background } = scene.canvas;
    ctx.save();
    ctx.fillStyle = background || '#0F1115';
    ctx.fillRect(0, 0, width, height);
    for (const layer of scene.tracks) {
      renderLayer(layer, t, ctx, imageCache);
    }
    ctx.restore();
  }

  function renderLayer(layer, t, ctx, imageCache) {
    const kf = layer.keyframes;
    const x = getInterpolatedProp(kf, 'x', layer.x ?? 0, t);
    const y = getInterpolatedProp(kf, 'y', layer.y ?? 0, t);
    const rot = getInterpolatedProp(kf, 'rotation', layer.rotation ?? 0, t);
    const sx = getInterpolatedProp(kf, 'scaleX', layer.scaleX ?? 1, t);
    const sy = getInterpolatedProp(kf, 'scaleY', layer.scaleY ?? 1, t);
    const op = Math.max(0, Math.min(1, getInterpolatedProp(kf, 'opacity', layer.opacity ?? 1, t)));

    if (op <= 0 || sx === 0 || sy === 0) return;

    ctx.save();
    ctx.translate(x, y);
    if (rot !== 0) ctx.rotate((rot * Math.PI) / 180);
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    ctx.globalAlpha *= op;

    if (layer.type === 'text') {
      const fs = getInterpolatedProp(kf, 'fontSize', layer.fontSize ?? 48, t);
      const col = getInterpolatedProp(kf, 'color', layer.color ?? '#FFFFFF', t);
      ctx.font = (layer.fontWeight || 600) + ' ' + fs + 'px ' + (layer.fontFamily || 'sans-serif');
      ctx.fillStyle = col;
      ctx.textAlign = layer.align || 'center';
      ctx.textBaseline = 'middle';
      let txt = layer.text;
      if (layer.stagger) {
        const st = layer.stagger.startTime ?? 0;
        const d = layer.stagger.duration;
        if (t < st) txt = '';
        else if (t < st + d && d > 0) {
          const p = (t - st) / d;
          if (layer.stagger.mode === 'letter') {
            const arr = Array.from(layer.text);
            txt = arr.slice(0, Math.floor(p * arr.length)).join('');
          } else if (layer.stagger.mode === 'word') {
            const words = layer.text.split(' ');
            txt = words.slice(0, Math.floor(p * words.length)).join(' ');
          }
        }
      }
      if (txt) ctx.fillText(txt, 0, 0);
    } else if (layer.type === 'rect') {
      const w = getInterpolatedProp(kf, 'width', layer.width, t);
      const h = getInterpolatedProp(kf, 'height', layer.height, t);
      const fill = getInterpolatedProp(kf, 'fill', layer.fill ?? '#FF5B3A', t);
      const ax = layer.anchorX ?? 0.5;
      const ay = layer.anchorY ?? 0.5;
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(-ax * w, -ay * h, w, h);
      }
    } else if (layer.type === 'circle') {
      const rad = getInterpolatedProp(kf, 'radius', layer.radius, t);
      const fill = getInterpolatedProp(kf, 'fill', layer.fill ?? '#FF5B3A', t);
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(0, rad), 0, Math.PI * 2);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
    }
    ctx.restore();
  }

  global.MotionSceneEngine = {
    version: '1.0.0',
    applyEasing: applyEasing,
    renderScene: renderScene,
  };
})(typeof self !== 'undefined' ? self : window);
