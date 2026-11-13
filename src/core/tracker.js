// MediaPipe Face Landmarker wrapper (478 landmarks incl. irises + transformation matrix).
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export class FaceTracker {
  constructor() {
    this.landmarker = null;
    this.mode = "VIDEO";
    this.lastTs = -1;
  }

  async init() {
    const base = import.meta.env.BASE_URL;
    const fileset = await FilesetResolver.forVisionTasks(`${base}vendor/mediapipe-wasm`);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: this.mode,
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, opts("GPU"));
    } catch (e) {
      console.warn("[tracker] GPU delegate failed, using CPU", e);
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, opts("CPU"));
    }
    return this;
  }

  async setMode(mode) {
    if (mode !== this.mode) {
      this.mode = mode;
      await this.landmarker.setOptions({ runningMode: mode });
    }
  }

  /** returns {landmarks, matrix} or null */
  detectVideo(video, now = performance.now()) {
    if (!this.landmarker || video.readyState < 2) return null;
    const ts = Math.max(now, this.lastTs + 1);
    this.lastTs = ts;
    return pick(this.landmarker.detectForVideo(video, ts));
  }

  async detectImage(image) {
    await this.setMode("IMAGE");
    return pick(this.landmarker.detect(image));
  }
}

function pick(res) {
  if (!res?.faceLandmarks?.length) return null;
  return {
    landmarks: res.faceLandmarks[0],
    matrix: res.facialTransformationMatrixes?.[0]?.data ?? null,
  };
}

/** Triangles of the face mesh, rebuilt from MediaPipe's tessellation edge list. */
export function faceTriangles() {
  const edges = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
  const tris = [];
  for (let i = 0; i + 2 < edges.length; i += 3) {
    tris.push(edges[i].start, edges[i + 1].start, edges[i + 2].start);
  }
  return tris;
}
