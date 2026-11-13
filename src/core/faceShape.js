// Face-shape estimation from MediaPipe landmarks.
//
// Four scale-free proportions are measured in the face's own frame (so distance and
// head tilt cancel out), each divided by the cheekbone width (234-454):
//   length   forehead landmark (10) to chin (152)        - long vs short face
//   forehead width at the temples (54-284)                - broad vs narrow forehead
//   jaw      width at the jaw angle (172-397)            - strong vs tapered jaw
//   chin     width of the lower jaw near the chin (150-379) - broad vs pointed chin
//
// The baseline is MediaPipe's own canonical (average) face model; each shape is a
// typical deviation from it. A Gaussian score per shape becomes a probability, which is
// what the UI shows as the confidence. Samples are taken only while the face is frontal,
// and medians over many frames are used so one noisy frame can't flip the result.
import * as THREE from "three";
import { RunningMedian } from "./filters.js";

export const SHAPES = ["oval", "round", "square", "heart", "diamond", "oblong"];

// canonical_face_model.obj proportions (relative to cheekbone width)
const BASE = { length: 1.152, forehead: 0.819, jaw: 0.775, chin: 0.531 };
// expected spread of each proportion between people / between frames
const SD = { length: 0.06, forehead: 0.035, jaw: 0.035, chin: 0.04 };
// typical deviation from the average face for each shape
const PROTO = {
  oval:    { length: +0.05, forehead: +0.00, jaw: -0.01, chin: -0.01 },
  round:   { length: -0.09, forehead: +0.00, jaw: +0.02, chin: +0.01 },
  square:  { length: -0.05, forehead: +0.02, jaw: +0.07, chin: +0.07 },
  heart:   { length: +0.01, forehead: +0.06, jaw: -0.05, chin: -0.07 },
  diamond: { length: +0.04, forehead: -0.07, jaw: -0.05, chin: -0.04 },
  oblong:  { length: +0.16, forehead: +0.01, jaw: +0.03, chin: +0.02 },
};
const PAIRS = { forehead: [54, 284], jaw: [172, 397], chin: [150, 379] };
const MIN_SAMPLES = 12;
// Not yet validated against labelled faces, so scores are softened (temperature) and
// capped: the UI should never present a face shape as certain.
const TEMPERATURE = 2.2;
const MAX_CONFIDENCE = 0.9;

const _qi = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function local(P, i, origin, out) {
  return out.subVectors(P[i], origin).applyQuaternion(_qi);
}

/** Proportions of one frame (pixel-space landmarks + raw head rotation). */
export function measure(P, quat) {
  _qi.copy(quat).invert();
  const o = P[168];
  const width = (i, j) => Math.abs(local(P, i, o, _a).x - local(P, j, o, _b).x);
  const cheek = width(234, 454);
  if (!(cheek > 1)) return null;
  const length = Math.abs(local(P, 10, o, _a).y - local(P, 152, o, _b).y) / cheek;
  const f = { length };
  for (const [k, [i, j]] of Object.entries(PAIRS)) f[k] = width(i, j) / cheek;
  return f;
}

/** Probability per shape for one set of proportions. */
export function classify(f) {
  const logp = SHAPES.map((s) => {
    let d2 = 0;
    for (const k of Object.keys(BASE)) {
      const z = (f[k] - BASE[k] - PROTO[s][k]) / SD[k];
      d2 += z * z;
    }
    return (-0.5 * d2) / TEMPERATURE;
  });
  const max = Math.max(...logp);
  const e = logp.map((l) => Math.exp(l - max));
  const sum = e.reduce((a, b) => a + b, 0);
  const ranked = SHAPES.map((s, i) => ({ shape: s, p: e[i] / sum })).sort((a, b) => b.p - a.p);
  if (ranked[0].p > MAX_CONFIDENCE) {
    // hand the excess to the other shapes in proportion
    const rest = 1 - ranked[0].p;
    const k = rest > 0 ? (1 - MAX_CONFIDENCE) / rest : 0;
    ranked.forEach((r, i) => { r.p = i === 0 ? MAX_CONFIDENCE : (rest > 0 ? r.p * k : (1 - MAX_CONFIDENCE) / (ranked.length - 1)); });
  }
  return ranked;
}

export class FaceShapeEstimator {
  constructor() {
    this.med = Object.fromEntries(Object.keys(BASE).map((k) => [k, new RunningMedian(90)]));
  }

  reset() {
    Object.values(this.med).forEach((m) => m.reset());
  }

  get samples() {
    return this.med.length.count;
  }

  /** Add one frame; only frontal, level frames are used. */
  push(P, pose) {
    if (Math.abs(pose.yaw) > 10 || Math.abs(pose.pitch) > 12 || Math.abs(pose.roll) > 15) return;
    const f = measure(P, pose.quat);
    if (f) for (const k of Object.keys(BASE)) this.med[k].push(f[k]);
  }

  /** null until enough frontal samples, else { shape, confidence, ranked, features, samples }. */
  result() {
    if (this.samples < MIN_SAMPLES) return null;
    const features = Object.fromEntries(Object.keys(BASE).map((k) => [k, this.med[k].value]));
    const ranked = classify(features);
    return { shape: ranked[0].shape, confidence: ranked[0].p, ranked, features, samples: this.samples };
  }
}
