// Frame recommendations from the estimated face shape (+ face width when known).
//
// Each model is tagged with the face shapes it usually suits (catalog face_shapes).
// The shape score is the probability mass of the shapes it suits, so an uncertain
// "oval 45% / round 35%" result still favours frames that suit both. When the face width
// is calibrated, the size (S/M/L) whose total width best matches the face is suggested
// and adds a small bonus. Recommendations are starting points: nothing is hidden.

export const ADVICE = {
  oval: "Balanced proportions suit most styles. Choose frames about as wide as the widest part of your face.",
  round: "Angular frames (rectangle, square, geometric, cat-eye) add definition and make the face look longer.",
  square: "Round and oval frames soften a strong jawline and angular features.",
  heart: "Light, rounded or bottom-weighted frames balance a wider forehead and a narrower chin.",
  diamond: "Cat-eye, oval and browline frames highlight the cheekbones and widen the brow line.",
  oblong: "Deeper frames with a strong top line make a long face look shorter. Aviators work well.",
};

// ideal: frame front a little wider than the cheekbones (mm)
const IDEAL_EXTRA_MM = 2;
const SIZE_SD_MM = 6;
const MIN_SHAPE_SCORE = 0.5;
const MAX_RECS = 6;

export function bestSize(model, faceWidthMM) {
  const sizes = Object.entries(model.sizes);
  if (!faceWidthMM) return { size: model.sizes.M ? "M" : sizes[0][0], fit: null };
  let best = null;
  for (const [size, v] of sizes) {
    const diff = v.dims_mm.total_width - faceWidthMM;
    const fit = Math.exp(-(((diff - IDEAL_EXTRA_MM) / SIZE_SD_MM) ** 2));
    if (!best || fit > best.fit) best = { size, fit, diff };
  }
  return best;
}

/**
 * @param models     catalog models (from loadCatalog)
 * @param faceShape  result of FaceShapeEstimator.result()
 * @param faceWidthMM calibrated face width or null
 * @returns [{ id, score, shapeScore, size, sizeFit, suits }] best first
 */
export function recommend(models, faceShape, faceWidthMM = null) {
  if (!faceShape) return [];
  const p = Object.fromEntries(faceShape.ranked.map((r) => [r.shape, r.p]));
  return models
    .map((m) => {
      const shapeScore = m.faceShapes.reduce((a, s) => a + (p[s] || 0), 0);
      const { size, fit } = bestSize(m, faceWidthMM);
      const score = fit == null ? shapeScore : 0.8 * shapeScore + 0.2 * fit;
      return { id: m.id, score, shapeScore, size, sizeFit: fit, suits: m.faceShapes.includes(faceShape.shape) };
    })
    .filter((r) => r.shapeScore >= MIN_SHAPE_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RECS);
}
