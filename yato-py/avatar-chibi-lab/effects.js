/* Optional, original Canvas effects. The approved character art is never changed. */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const PADDING = 18;
  const MATERIALIZE_SECONDS = 1.35;
  const MAX_PARTICLES = 12;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  class YatoEffects {
    constructor({canvasFactory} = {}) {
      this.canvasFactory = canvasFactory || (() => document.createElement('canvas'));
      this.clock = 0;
      this.materializeAge = -1;
      this.mask = null;
      this.halo = null;
      this.poseKey = undefined;
      this.lastMaskTime = -Infinity;
      this.maskBuilds = 0;
      this.active = false;
      this.reducedMotion = false;
    }

    triggerMaterialize() {
      // This requests one soft arrival pulse; it never enables effects itself.
      this.materializeAge = 0;
    }

    reset() {
      this.clock = 0;
      this.materializeAge = -1;
      this.poseKey = undefined;
      this.lastMaskTime = -Infinity;
      this.active = false;
    }

    snapshot() {
      return {
        enabled: this.active,
        reducedMotion: this.reducedMotion,
        materializing: this.active && !this.reducedMotion && this.materializeAge >= 0,
        materializeAge: this.materializeAge,
        clock: this.clock,
        particleLimit: MAX_PARTICLES,
        buffers: Number(Boolean(this.mask)) + Number(Boolean(this.halo)),
        maskBuilds: this.maskBuilds
      };
    }

    ensureBuffers(width, height) {
      if (!this.mask) {
        this.mask = this.canvasFactory();
        this.halo = this.canvasFactory();
      }
      if (this.mask.width === width && this.mask.height === height) return false;
      this.mask.width = this.halo.width = width;
      this.mask.height = this.halo.height = height;
      return true;
    }

    rebuildHalo(source) {
      const mask = this.mask.getContext('2d');
      const halo = this.halo.getContext('2d');
      const w = this.mask.width, h = this.mask.height;
      mask.clearRect(0, 0, w, h);
      mask.globalCompositeOperation = 'source-over';
      mask.drawImage(source, PADDING, PADDING);
      mask.globalCompositeOperation = 'source-in';
      mask.fillStyle = '#a889ff';
      mask.fillRect(0, 0, w, h);
      mask.globalCompositeOperation = 'source-over';

      halo.clearRect(0, 0, w, h);
      halo.save();
      // A broad, faint violet halo and a finer cool edge stay outside the art.
      halo.globalAlpha = .15;
      halo.filter = 'blur(5px)';
      halo.drawImage(this.mask, 0, 0);
      mask.globalCompositeOperation = 'source-in';
      mask.fillStyle = '#94d6eb';
      mask.fillRect(0, 0, w, h);
      mask.globalCompositeOperation = 'source-over';
      halo.globalAlpha = .13;
      halo.filter = 'blur(1.6px)';
      halo.drawImage(this.mask, 1, 0);
      halo.filter = 'none';
      halo.globalAlpha = 1;
      halo.globalCompositeOperation = 'destination-out';
      halo.drawImage(source, PADDING, PADDING);
      halo.restore();
      this.maskBuilds++;
    }

    /**
     * Draw BEFORE the regular character drawImage, in the same coordinate space.
     * x/y identify the top-left of source; scale maps source pixels to the stage.
     * enabled defaults to false. With false, no context or canvas is touched.
     * Give poseKey only when it identifies every pixel change of source. Omit it
     * for a blended pose; mask updates are then capped at 30 Hz. The caller keeps
     * full control of the avatar's scale, alpha, walking phase and colors.
     */
    render(ctx, source, x, y, scale, dt, options = {}) {
      this.active = Boolean(options.enabled);
      if (!this.active) {
        this.materializeAge = -1;
        return;
      }
      if (!source || !Number.isFinite(source.width) || !Number.isFinite(source.height)
        || source.width <= 0 || source.height <= 0
        || ![x, y, scale].every(Number.isFinite) || scale <= 0) return;

      const elapsed = Number.isFinite(dt) ? clamp(dt, 0, .05) : 0;
      this.reducedMotion = Boolean(options.reducedMotion);
      this.clock += elapsed;
      if (this.reducedMotion) this.materializeAge = -1;
      if (this.materializeAge >= 0) {
        this.materializeAge += elapsed;
        if (this.materializeAge >= MATERIALIZE_SECONDS) this.materializeAge = -1;
      }

      const resized = this.ensureBuffers(source.width + PADDING * 2, source.height + PADDING * 2);
      const keyed = options.poseKey !== undefined && options.poseKey !== null;
      const changed = keyed ? this.poseKey !== options.poseKey : this.clock - this.lastMaskTime >= 1 / 30;
      if (resized || changed || this.lastMaskTime === -Infinity) {
        this.rebuildHalo(source);
        this.poseKey = keyed ? options.poseKey : undefined;
        this.lastMaskTime = this.clock;
      }

      const pulse = this.materializeAge < 0 ? 0 : Math.sin(Math.PI * this.materializeAge / MATERIALIZE_SECONDS) ** 2;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      // source-over avoids an additive change to the character's opaque colors.
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha *= .8 + pulse * .2;
      ctx.drawImage(this.halo, -PADDING, -PADDING);
      ctx.restore();

      if (this.reducedMotion) return;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.globalCompositeOperation = 'source-over';
      const inheritedAlpha = ctx.globalAlpha;
      if(pulse>0){
        const progress=clamp(this.materializeAge/MATERIALIZE_SECONDS,0,1);
        const expand=1-(1-progress)*(1-progress);
        // A single expanding ground ring makes the command readable even at
        // the small desktop size. It stays behind the feet and never flashes
        // or recolors the character. Ambient effects are unchanged.
        ctx.globalAlpha=inheritedAlpha*.6*pulse;
        ctx.strokeStyle='#bba6ff';ctx.lineWidth=2.5;
        ctx.beginPath();
        ctx.ellipse(source.width/2,source.height-37,72+42*expand,7+7*expand,0,0,TAU);
        ctx.stroke();
      }
      // Fixed analytic particles require no per-frame allocation or history.
      // They rise slowly beside the body; six additional points appear only
      // during the explicit materialization. No flashes, scanline flicker or
      // autonomous materialization are tied to footsteps or speech.
      const count = pulse > 0 ? MAX_PARTICLES : 6;
      for (let i = 0; i < count; i++) {
        const special = i >= 6;
        const duration = 4.8 + (i % 3) * .9;
        const progress = (this.clock / duration + i * .173) % 1;
        const fade = Math.sin(progress * Math.PI) ** 2;
        const side = i % 2 ? 1 : -1;
        const center = source.width / 2;
        const drift = Math.sin(progress * TAU + i) * 7;
        const px = center + side * (84 + i % 3 * 13 + pulse * (special ? 22 : 3)) + drift;
        const py = source.height * (.91 - progress * .56);
        ctx.globalAlpha = inheritedAlpha * (special ? pulse*.6*(.4+.6*fade) : fade*.18);
        ctx.fillStyle = i % 3 ? '#bba6ff' : '#9bdde9';
        const size = special ? 4 : 1.5;
        ctx.fillRect(px - size / 2, py - size / 2, size, size);
      }
      ctx.restore();
    }
  }

  root.YatoEffects = YatoEffects;
  if (typeof module !== 'undefined' && module.exports) module.exports = YatoEffects;
})(typeof window !== 'undefined' ? window : globalThis);
