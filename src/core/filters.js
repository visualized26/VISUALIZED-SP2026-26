// One Euro filter (Casiez et al. 2012): strong smoothing when still, low lag when moving.
import * as THREE from "three";

function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.x = null;
    this.dx = 0;
    this.t = null;
  }

  reset() {
    this.x = null;
  }

  filter(value, t) {
    if (this.x === null) {
      this.x = value;
      this.dx = 0;
      this.t = t;
      return value;
    }
    const dt = Math.max((t - this.t) / 1000, 1e-3);
    this.t = t;
    const dx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

export class OneEuroVec3 {
  constructor(opts) {
    this.f = [new OneEuro(opts), new OneEuro(opts), new OneEuro(opts)];
  }

  reset() {
    this.f.forEach((f) => f.reset());
  }

  filter(v, t, out = new THREE.Vector3()) {
    return out.set(this.f[0].filter(v.x, t), this.f[1].filter(v.y, t), this.f[2].filter(v.z, t));
  }
}

/** Quaternion smoothing: One-Euro style adaptive slerp on angular speed. */
export class QuatFilter {
  constructor({ minCutoff = 1.2, beta = 0.6 } = {}) {
    Object.assign(this, { minCutoff, beta });
    this.q = null;
    this.t = null;
    this.speed = 0;
  }

  reset() {
    this.q = null;
  }

  filter(q, t) {
    if (!this.q) {
      this.q = q.clone();
      this.t = t;
      return this.q;
    }
    const dt = Math.max((t - this.t) / 1000, 1e-3);
    this.t = t;
    const ang = this.q.angleTo(q) / dt; // rad/s
    this.speed += alpha(1.0, dt) * (ang - this.speed);
    const a = alpha(this.minCutoff + this.beta * this.speed, dt);
    this.q.slerp(q, a);
    return this.q;
  }
}

/** Robust running estimate (median of a sliding window). */
export class RunningMedian {
  constructor(size = 90) {
    this.size = size;
    this.values = [];
  }

  push(v) {
    if (!Number.isFinite(v)) return this.value;
    this.values.push(v);
    if (this.values.length > this.size) this.values.shift();
    return this.value;
  }

  get value() {
    if (!this.values.length) return null;
    const s = [...this.values].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  get count() {
    return this.values.length;
  }

  reset() {
    this.values = [];
  }
}
