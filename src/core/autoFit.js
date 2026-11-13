// Automatic frame placement (like an optician seating a frame on the face).
//
// Everything is computed in the *face frame*, in millimetres: origin = midpoint of the
// two irises, +x = wearer's left, +y = up, +z = forward (out of the face).
//
//  - Height: pupils sit slightly above the lens box centre (PUPIL_ABOVE_CENTRE of the
//    lens height), the usual fashion fitting.
//  - Depth: the frame's back surface is pushed forward until it clears every nose /
//    cheek landmark that lies inside its footprint by CLEARANCE_MM, and never sits
//    closer than MIN_VERTEX_MM to the eyes. The nose passes through the open space
//    under the bridge, so only points above the bridge's lower edge count there.
import * as THREE from "three";

export const AUTO = {
  CLEARANCE_MM: 1.5,
  MIN_VERTEX_MM: 10,
  MAX_VERTEX_MM: 24,
  PUPIL_ABOVE_CENTRE: 0.06,
};

// landmarks that can touch a frame: nose ridge/sides + under-eye cheeks
// (eyebrows, eyelids and irises are excluded; the brow sits above the frame)
const EXCLUDE = new Set([
  // brows
  46, 52, 53, 55, 63, 65, 66, 70, 105, 107, 276, 282, 283, 285, 293, 295, 296, 300, 334, 336,
  // eyelids / eye contours
  7, 33, 133, 144, 145, 153, 154, 155, 157, 158, 159, 160, 161, 163, 173, 246,
  249, 263, 362, 373, 374, 380, 381, 382, 384, 385, 386, 387, 388, 390, 398, 466,
]);

const _v = new THREE.Vector3();
const _qi = new THREE.Quaternion();

/**
 * @param P      landmark positions in pixel space (THREE.Vector3[])
 * @param mid    eye midpoint (pixel space, smoothed)
 * @param quat   head rotation (smoothed)
 * @param mmPerPx
 * @param geom   { lensW, lensH, bridge, totalW, wrapDeg, bridgeBottomMM, tiltDeg }
 * @returns { oy, oz, limit } in mm (mount offsets in the face frame)
 */
export function computeAutoFit(P, mid, quat, mmPerPx, geom) {
  const oy = -AUTO.PUPIL_ABOVE_CENTRE * geom.lensH;
  const halfW = geom.totalW / 2 - 1.5;
  const halfBridge = geom.bridge / 2 + 0.5;
  const cx = (geom.lensW + geom.bridge) / 2;
  const R = geom.wrapDeg > 0 ? cx / Math.tan(THREE.MathUtils.degToRad(geom.wrapDeg)) : Infinity;
  const st = Math.sin(THREE.MathUtils.degToRad(geom.tiltDeg));
  const bottom = -(geom.lensH / 2 + 4); // lower edge of the rim (model y)
  const top = geom.lensH * 0.2; // ignore the upper part (it never touches the face)
  _qi.copy(quat).invert();

  let oz = AUTO.MIN_VERTEX_MM;
  let limit = "eyes";
  const n = Math.min(P.length, 468);
  for (let i = 0; i < n; i++) {
    if (EXCLUDE.has(i)) continue;
    _v.subVectors(P[i], mid).applyQuaternion(_qi).multiplyScalar(mmPerPx);
    const x = _v.x, ym = _v.y - oy, z = _v.z;
    if (Math.abs(x) > halfW || ym < bottom) continue;
    if (Math.abs(x) < halfBridge) {
      // bridge zone: the nose passes through the open space under the bridge,
      // and the bridge itself (bottom edge up to ~8 mm above) rests on the ridge
      if (ym < geom.bridgeBottomMM || ym > geom.bridgeBottomMM + 8) continue;
    } else if (ym > top) {
      continue; // upper rims never touch the face (brows sit above them)
    }
    const back = (R === Infinity ? 0 : -(x * x) / (2 * R)) + ym * st;
    const req = z + AUTO.CLEARANCE_MM - back;
    if (req > oz) {
      oz = req;
      limit = Math.abs(x) < halfBridge + 4 ? "nose" : "cheeks";
    }
  }
  return { oy, oz: Math.min(oz, AUTO.MAX_VERTEX_MM), limit };
}
