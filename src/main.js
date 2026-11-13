import "./styles/main.css";
import { Camera, cameraErrorMessage } from "./core/camera.js";
import { FaceTracker } from "./core/tracker.js";
import { TryOnRenderer, DEFAULT_FIT } from "./core/tryon.js";
import { loadCatalog } from "./core/catalog.js";
import { createStore, local } from "./core/store.js";
import { mountCatalog, mountTools } from "./ui/panels.js";
import { saveSet, dataUrlToBlob } from "./core/gallery.js";
import { openGallery, refreshGalleryCount } from "./ui/gallery.js";
import { recommend } from "./core/recommend.js";

const $ = (s) => document.querySelector(s);
const video = $("#video");
const canvas = $("#view");

const store = createStore({
  models: [], finishes: { finishes: {}, lenses: {} },
  category: "all", query: "", modelId: null, size: "M", finish: null, lens: "clear",
  fit: { ...DEFAULT_FIT }, openTool: "custom", pose: null,
  faceShape: null, recs: [], recommended: [], // kept after the camera stops
  favorites: local.read("favorites", []), source: "none", // none | camera | photo
});

const camera = new Camera(video);
const tracker = new FaceTracker();
const tryon = new TryOnRenderer(canvas);
tryon.onAsyncChange = () => redrawStill();
let trackerReady = null;
let loop = 0;
let lastPoseUpdate = 0;
let fps = { n: 0, t: performance.now(), v: 0 };
let showHud = false;

// ------------------------------------------------------------------ status helpers
function status(text, kind = "") {
  const el = $("#camStatus");
  el.textContent = text;
  el.className = `pill ${kind}`;
}
function message(text) {
  const el = $("#stageMsg");
  el.hidden = !text;
  el.textContent = text || "";
}
function stageActive(on) {
  $("#stageEmpty").hidden = on;
  $("#stageTools").hidden = !on;
  canvas.classList.toggle("on", on);
}
function ensureTracker() {
  trackerReady ||= tracker.init().catch((e) => {
    trackerReady = null;
    throw e;
  });
  return trackerReady;
}

// ------------------------------------------------------------------ actions
const actions = {
  async selectModel(id) {
    const s = store.get();
    const m = s.models.find((x) => x.id === id);
    if (!m) return;
    const size = m.sizes[s.size] ? s.size : "M";
    store.set({ modelId: id, size, finish: m.defaultFinish, lens: m.defaultLens || "clear" });
    await applyVariant();
  },
  async selectSize(size) {
    store.set({ size });
    await applyVariant();
  },
  selectFinish(finish) {
    store.set({ finish });
    tryon.applyFinish(finish, store.get().finishes);
    redrawStill();
  },
  selectLens(lens) {
    store.set({ lens });
    tryon.applyLens(lens, store.get().finishes);
    redrawStill();
  },
  setFit(key, value) {
    store.set((s) => ({ fit: { ...s.fit, [key]: value } }));
    tryon.fit[key] = value;
    if (store.get().source === "photo") renderPhoto();
  },
  async tryRecommendation(id, size) {
    if (store.get().modelId !== id) await actions.selectModel(id);
    if (size && store.get().size !== size && store.get().models.find((m) => m.id === id)?.sizes[size]) {
      await actions.selectSize(size);
    }
  },
  showMatches() {
    store.set({ category: "match", query: "" });
    document.querySelector("#search").value = "";
  },
  rescanShape() {
    tryon.faceShape.reset();
    store.set({ faceShape: null, recs: [], recommended: [], category: store.get().category === "match" ? "all" : store.get().category });
    if (store.get().source === "photo") renderPhoto();
  },
  resetFit() {
    store.set({ fit: { ...DEFAULT_FIT } });
    Object.assign(tryon.fit, DEFAULT_FIT);
    document.querySelectorAll("[data-fit]").forEach((r) => (r.value = DEFAULT_FIT[r.dataset.fit]));
    if (store.get().source === "photo") renderPhoto();
  },
};

async function applyVariant() {
  const s = store.get();
  const m = s.models.find((x) => x.id === s.modelId);
  const v = m?.sizes[s.size];
  if (!v) return;
  message("Loading frame...");
  try {
    await tryon.loadFrame(v, s.finishes);
    tryon.applyFinish(s.finish, s.finishes);
    tryon.applyLens(s.lens, s.finishes);
    message("");
  } catch (e) {
    console.error(e);
    message("Could not load this frame model.");
  }
  if (s.source === "photo") renderPhoto();
}

// ------------------------------------------------------------------ camera mode
async function startCamera() {
  stopLoop();
  status("Starting camera...", "busy");
  try {
    const [dims] = await Promise.all([camera.start(), ensureTracker()]);
    await tracker.setMode("VIDEO");
    tryon.setSource(video, dims.width, dims.height);
    store.set({ source: "camera" });
    stageActive(true);
    status("Camera ready", "ok");
    message("");
    loop = requestAnimationFrame(tick);
  } catch (e) {
    console.error(e);
    camera.stop();
    status("Camera off");
    message(e?.name ? cameraErrorMessage(e) : `Could not start face tracking: ${e.message}`);
  }
}

function stopCamera() {
  stopLoop();
  camera.stop();
  store.set({ source: "none", pose: null });
  stageActive(false);
  status("Camera off");
  message("");
  $("#hud").hidden = true;
}

function stopLoop() {
  cancelAnimationFrame(loop);
  loop = 0;
}

let lostFrames = 0;
function tick(now) {
  loop = requestAnimationFrame(tick);
  const res = tracker.detectVideo(video, now);
  const pose = tryon.update(res, now);
  tryon.render();
  lostFrames = res ? 0 : lostFrames + 1;
  message(lostFrames > 20 ? "Face not detected - face the camera in good, even light." : "");
  fps.n++;
  if (now - fps.t > 500) {
    fps.v = (fps.n * 1000) / (now - fps.t);
    fps.n = 0;
    fps.t = now;
  }
  if (now - lastPoseUpdate > 250) {
    lastPoseUpdate = now;
    store.set({ pose, ...analysis(pose) });
    if (showHud) hud(pose, res);
  }
}

function hud(pose, res) {
  const el = $("#hud");
  el.hidden = false;
  el.innerHTML = pose
    ? `${fps.v.toFixed(0)} fps · ${res?.landmarks.length ?? 0} landmarks<br>
       yaw ${pose.yaw.toFixed(0)}° · pitch ${pose.pitch.toFixed(0)}° · roll ${pose.roll.toFixed(0)}°<br>
       ${pose.calibrated ? "scale calibrated" : "calibrating scale..."} · ${(1 / pose.mmPerPxSmoothed).toFixed(2)} px/mm<br>
       auto-fit: ${pose.auto ? `${pose.auto.oz.toFixed(1)} mm from eyes (set by ${pose.auto.limit})` : "-"}`
    : `${fps.v.toFixed(0)} fps · no face`;
}

// ------------------------------------------------------------------ photo mode
let photo = null;
let photoResult = null;
async function usePhoto(file) {
  if (!file) return;
  stopLoop();
  camera.stop();
  status("Analysing photo...", "busy");
  try {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    await ensureTracker();
    photo = img;
    tryon.setSource(img, img.naturalWidth, img.naturalHeight);
    photoResult = await tracker.detectImage(img);
    store.set({ source: "photo" });
    stageActive(true);
    status("Photo", "ok");
    message(photoResult ? "" : "No face found in this photo. Try a clear, front-facing photo.");
    renderPhoto();
  } catch (e) {
    console.error(e);
    status("Camera off");
    message(`Could not use this photo: ${e.message}`);
  }
}

// a photo is drawn once (no render loop), so material-only changes need a redraw
function redrawStill() {
  if (store.get().source === "photo" && photo) tryon.render();
}

function renderPhoto() {
  if (!photo) return;
  // static image: run the update a few times so filters settle on the exact pose
  tryon.resetTracking();
  let pose = null;
  for (let i = 0; i < 150; i++) pose = tryon.update(photoResult, i * 33);
  tryon.render();
  store.set({ pose, ...analysis(pose) });
}

// face shape + recommendations (only replaced when a new estimate exists)
function analysis(pose) {
  const fs = pose?.faceShape;
  if (!fs) return {};
  const recs = recommend(store.get().models, fs, pose.calibrated ? pose.faceWidthMM : null);
  return { faceShape: fs, recs, recommended: recs.map((r) => r.id) };
}

// ------------------------------------------------------------------ favorites / angles
function toggleFavorite() {
  const { modelId, favorites } = store.get();
  if (!modelId) return;
  const next = favorites.includes(modelId) ? favorites.filter((x) => x !== modelId) : [...favorites, modelId];
  local.write("favorites", next);
  store.set({ favorites: next });
}

// ------------------------------------------------------------------ multi-angle sets
const shots = { left: null, front: null, right: null };
const TURN = { left: "Turn your head to your left", right: "Turn your head to your right", front: "Look straight at the camera" };
let countdownTimer = 0;

function refreshSetUI() {
  document.querySelectorAll(".angle").forEach((el) => {
    const url = shots[el.dataset.angle];
    el.style.backgroundImage = url ? `url(${url})` : "";
    el.classList.toggle("filled", !!url);
  });
  $("#saveSet").disabled = !(shots.left && shots.front && shots.right);
}

function captureAngle(slot) {
  const src = store.get().source;
  if (src === "none") {
    message("Start the camera or use a photo first.");
    return;
  }
  const angle = slot.dataset.angle;
  const take = () => {
    shots[angle] = tryon.snapshot(true);
    refreshSetUI();
  };
  if (src === "photo") return take();
  clearInterval(countdownTimer);
  const el = $("#countdown");
  let n = 3;
  el.hidden = false;
  el.innerHTML = `<b>${n}</b><span>${TURN[angle]}</span>`;
  countdownTimer = setInterval(() => {
    n -= 1;
    if (n > 0) {
      el.querySelector("b").textContent = n;
      return;
    }
    clearInterval(countdownTimer);
    el.hidden = true;
    take();
  }, 1000);
}

async function saveCurrentSet() {
  const s = store.get();
  const m = s.models.find((x) => x.id === s.modelId);
  const frame = { modelId: m.id, name: m.name, size: s.size, finish: s.finish, lens: s.lens,
    finishName: s.finish.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) };
  const blobs = Object.fromEntries(Object.entries(shots).map(([k, v]) => [k, dataUrlToBlob(v)]));
  const { persistent } = await saveSet({ frame, shots: blobs });
  shots.left = shots.front = shots.right = null;
  refreshSetUI();
  await refreshGalleryCount();
  message(persistent ? "Set saved to your Gallery." : "Saved for this visit only (browser storage is unavailable).");
  setTimeout(() => message(""), 2500);
}

// ------------------------------------------------------------------ boot
async function boot() {
  status("Loading catalog...", "busy");
  try {
    const { models, finishes } = await loadCatalog();
    store.set({ models, finishes });
    mountCatalog(store, actions);
    mountTools(store, actions);
    await actions.selectModel(models[0].id);
    status("Camera off");
  } catch (e) {
    console.error(e);
    status("Error", "err");
    message("Could not load the frame catalog.");
  }
  ensureTracker().catch((e) => console.warn("[tracker] preload failed", e));

  $("#startCam").addEventListener("click", startCamera);
  $("#stopCam").addEventListener("click", stopCamera);
  $("#photoInput").addEventListener("change", (e) => usePhoto(e.target.files[0]));
  $("#favToggle").addEventListener("click", toggleFavorite);
  $("#hudToggle").addEventListener("click", () => {
    showHud = !showHud;
    $("#hud").hidden = !showHud;
  });
  $("#angles").addEventListener("click", (e) => {
    const b = e.target.closest(".angle");
    if (b) captureAngle(b);
  });
  $("#saveSet").addEventListener("click", saveCurrentSet);
  $("#clearSet").addEventListener("click", () => {
    shots.left = shots.front = shots.right = null;
    refreshSetUI();
  });
  refreshGalleryCount();
  document.querySelectorAll("[data-nav]").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.nav === "gallery") {
        openGallery({
          onTryFrame: async (f) => {
            await actions.selectModel(f.modelId);
            if (f.size !== store.get().size) await actions.selectSize(f.size);
            actions.selectFinish(f.finish);
            actions.selectLens(f.lens);
          },
        });
        return;
      }
      message(`${b.textContent.trim()} is coming in the next build step.`);
      setTimeout(() => message(""), 2500);
    }));
  window.addEventListener("resize", () => tryon.resize());

  store.subscribe((s, prev) => {
    if (s.favorites !== prev.favorites || s.modelId !== prev.modelId) {
      $("#favToggle").textContent = s.favorites.includes(s.modelId) ? "♥ Saved" : "♡ Save";
      $("#favCount").textContent = s.favorites.length || "";
    }
  });
}

boot();
if (import.meta.env.DEV) window.__vz = { tryon, store, actions };
