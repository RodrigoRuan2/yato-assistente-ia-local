'use strict';

// Timing only: the desktop controller owns movement, interactions and enablement.
class YatoRoutine {
  constructor({random=Math.random, idle=[8, 16], walk=[3, 6]}={}) {
    this.random = random;
    this.idle = [...idle];
    this.walk = [...walk];
    this.reset();
  }

  duration(range) {
    return range[0] + (range[1] - range[0]) * this.random();
  }

  reset() {
    this.phase = 'idle';
    this.remaining = this.duration(this.idle);
    this.blocked = false;
    return this.snapshot();
  }

  snapshot() {
    return {phase:this.phase, remaining:this.remaining, blocked:this.blocked};
  }

  step(dt, blocked=false) {
    blocked = Boolean(blocked);
    if (blocked) {
      // A sustained hover/conversation/gesture must not keep drawing new timers.
      if (!this.blocked) this.reset();
      this.blocked = true;
      return {...this.snapshot(), startedWalking:false, direction:null};
    }

    this.blocked = false;
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, .1)) : 0;
    this.remaining = Math.max(0, this.remaining - dt);
    let startedWalking = false;
    let direction = null;
    // Avoid an extra frame caused only by repeated floating-point subtraction.
    if (this.remaining <= 1e-9) {
      if (this.phase === 'idle') {
        this.phase = 'walking';
        this.remaining = this.duration(this.walk);
        startedWalking = true;
        direction = this.random() < .5 ? -1 : 1;
      } else {
        this.phase = 'idle';
        this.remaining = this.duration(this.idle);
      }
    }
    return {...this.snapshot(), startedWalking, direction};
  }
}

module.exports = YatoRoutine;
