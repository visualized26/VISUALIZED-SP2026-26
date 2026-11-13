// Head pose + metric scale from MediaPipe landmarks, in *image pixel space*:
// x right, y up, z toward the camera (unmirrored image). The model's +X (wearer's left)
// appears on the image's right, so model space and pixel space share handedness.
import * as THREE from "three";
import { RunningMedian } from "./filters.js";

export const LM = {
  rightEyeOuter: 33, leftEyeOuter: 263, rightEyeInner: 133, leftEyeInner: 362,
  rightCheek: 234, leftCheek: 454, forehead: 10, chin: 152, noseBridge: 168, noseTip: 1,
  rightIris: 468, leftIris: 473, rightTemple: 127, leftTemple: 356,
};
const IRIS_R = [469, 470, 471, 472];
const IRIS_L = [474, 475, 476, 477];
export const IRIS_DIAMETER_MM = 11.7; // population average horizontal visible iris diameter

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

export function toPixels(landmarks, W, H, out = []) {
  for (let i = 0; i < landmarks.length; i++) {
    const l = landmarks[i];
    (out[i] ||= new THREE.Vector3()).set(l.x * W, (1 - l.y) * H, -l.z * W);
  }
  out.length = landmarks.length;
  return out;
}

function irisDiameterPx(P, ids) {
  const [r, t, l, b] = ids.map((i) => P[i]);
  const h = Math.hypot(r.x - l.x, r.y - l.y);
  const v = Math.hypot(t.x - b.x, t.y - b.y);
  return (h + v) / 2;
}

/** Calibrates mm-per-pixel over time using the iris as a ruler. */
export class FaceMetrics {
  constructor() {
    this.faceWidthMM = new RunningMedian(120);
    this.pdMM = new RunningMedian(120);
    this.irisRatio = new RunningMedian(120);
  }

  reset() {
    this.faceWidthMM.reset();
    this.pdMM.reset();
    this.irisRatio.reset();
  }

  get calibrated() {
    return this.faceWidthMM.count >= 15;
  }
}

/** Compute the raw (unsmoothed) pose for one frame. */
export function computePose(P, metrics) {
  const rEO = P[LM.rightEyeOuter], lEO = P[LM.leftEyeOuter];
  const rC = P[LM.rightCheek], lC = P[LM.leftCheek];
  _x.subVectors(lEO, rEO).add(_y.subVectors(lC, rC)).normalize();
  _y.subVectors(P[LM.forehead], P[LM.chin]);
  _z.crossVectors(_x, _y).normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x, _y, _z);
  const quat = new THREE.Quaternion().setFromRotationMatrix(_m);
  const euler = new THREE.Euler().setFromQuaternion(quat, "YXZ");
  const yaw = THREE.MathUtils.radToDeg(euler.y);
  const pitch = THREE.MathUtils.radToDeg(euler.x);
  const roll = THREE.MathUtils.radToDeg(euler.z);

  const irisPx = (irisDiameterPx(P, IRIS_R) + irisDiameterPx(P, IRIS_L)) / 2;
  const faceWidthPx = rC.distanceTo(lC);
  const pdPx = P[LM.rightIris].distanceTo(P[LM.leftIris]);
  const frontal = Math.abs(yaw) < 12 && Math.abs(pitch) < 15;
  if (frontal && irisPx > 4) {
    const mmPx = IRIS_DIAMETER_MM / irisPx;
    metrics.faceWidthMM.push(faceWidthPx * mmPx);
    metrics.pdMM.push(pdPx * mmPx);
    metrics.irisRatio.push(faceWidthPx / irisPx);
  }
  // live scale: prefer the calibrated face width (much less noisy than the iris itself)
  const mmPerPx = metrics.calibrated
    ? metrics.faceWidthMM.value / faceWidthPx
    : IRIS_DIAMETER_MM / Math.max(irisPx, 1);

  const eyeMid = new THREE.Vector3().addVectors(P[LM.rightIris], P[LM.leftIris]).multiplyScalar(0.5);
  return {
    quat, yaw, pitch, roll, eyeMid, mmPerPx, irisPx, faceWidthPx, pdPx, frontal,
    axes: { x: _x.clone(), y: _y.clone(), z: _z.clone() },
  };
}
