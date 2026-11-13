// Three.js try-on renderer. World units = source-image pixels (orthographic camera),
// x right, y up, z toward the viewer. The canvas is mirrored with CSS for a mirror view.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { OneEuro, OneEuroVec3, QuatFilter } from "./filters.js";
import { FaceMetrics, computePose, toPixels } from "./facePose.js";
import { faceTriangles } from "./tracker.js";

const BASE = import.meta.env.BASE_URL;

export const DEFAULT_FIT = {
  offsetY: -1.5, // mm: lens datum relative to pupils (negative = lower)
  offsetZ: 11.0, // mm: frame back plane in front of the iris (vertex distance)
  tilt: 8, // deg: pantoscopic tilt as worn
  scale: 1.0, // manual size correction
};

export class TryOnRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false,
      preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral keeps black acetate black and colours true (AgX washed them out)
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 1, 10000);
    this.camera.position.z = 4000;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    this.light = new THREE.DirectionalLight(0xffffff, 1.3);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.radius = 6;
    this.light.shadow.bias = -0.0008;
    this.scene.add(this.light, this.light.target);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 0.25));

    // background (camera image)
    this.bgMat = new THREE.MeshBasicMaterial({ toneMapped: false, depthWrite: false });
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.bgMat);
    this.bg.renderOrder = -10;
    this.bg.position.z = -3000;
    this.scene.add(this.bg);

    // face mesh: depth-only occluder (pushed back so it never cuts the frame front -
    // it only has to hide the temples) + a shadow catcher sitting on the skin
    this.tris = faceTriangles();
    const faceGeometry = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(478 * 3), 3));
      g.setIndex(this.tris);
      return g;
    };
    this.occGeo = faceGeometry();
    this.faceGeo = faceGeometry();
    this.faceOccluder = new THREE.Mesh(this.occGeo,
      new THREE.MeshBasicMaterial({ colorWrite: false }));
    this.faceOccluder.renderOrder = -5;
    this.faceShadow = new THREE.Mesh(this.faceGeo,
      new THREE.ShadowMaterial({ opacity: 0.28, depthWrite: false }));
    this.faceShadow.receiveShadow = true;
    this.faceShadow.renderOrder = 1;
    for (const m of [this.faceOccluder, this.faceShadow]) {
      m.frustumCulled = false;
      m.visible = false;
      this.scene.add(m);
    }

    // glasses rig: pivot at the eye midpoint, rotated with the head, scaled px/m
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.headOccluder = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20),
      new THREE.MeshBasicMaterial({ colorWrite: false }));
    this.headOccluder.renderOrder = -5;
    // side-of-head block: hides the temple arms from ~25 mm behind the front onwards
    this.sideOccluder = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ colorWrite: false }));
    this.sideOccluder.renderOrder = -5;
    this.pivot.add(this.headOccluder, this.sideOccluder);
    this.mount = new THREE.Group(); // fit offsets live here
    this.pivot.add(this.mount);
    this.pivot.visible = false;

    this.loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(`${BASE}vendor/draco/`);
    this.loader.setDRACOLoader(draco);
    this.texLoader = new THREE.TextureLoader();
    this.cache = new Map();
    this.textures = new Map();
    this.current = null;

    this.fit = { ...DEFAULT_FIT };
    this.occluderInsetMM = 16; // how far behind the skin the face occluder sits
    this.metrics = new FaceMetrics();
    this.fPos = new OneEuroVec3({ minCutoff: 1.2, beta: 0.015 });
    this.fQuat = new QuatFilter({ minCutoff: 1.5, beta: 0.5 });
    this.fScale = new OneEuro({ minCutoff: 0.4, beta: 0.0 });
    this.P = [];
    this.lastPose = null;
    this.W = 1;
    this.H = 1;
  }

  // ---------------------------------------------------------------- source
  setSource(el, W, H) {
    this.W = W;
    this.H = H;
    this.bgMat.map?.dispose();
    const tex = el instanceof HTMLVideoElement ? new THREE.VideoTexture(el) : new THREE.Texture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.bgMat.map = tex;
    this.bgMat.needsUpdate = true;
    this.bg.scale.set(W, H, 1);
    this.bg.position.set(W / 2, H / 2, -3000);
    Object.assign(this.camera, { left: 0, right: W, top: H, bottom: 0 });
    this.camera.updateProjectionMatrix();
    const s = this.light.shadow.camera;
    Object.assign(s, { left: -W, right: W, top: H, bottom: -H, near: 1, far: 12000 });
    s.updateProjectionMatrix();
    this.resetTracking();
    this.resize();
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const aspect = this.W / this.H;
    let w = r.width, h = r.width / aspect;
    if (h > r.height) {
      h = r.height;
      w = h * aspect;
    }
    this.renderer.setSize(Math.round(w), Math.round(h), false);
    this.canvas.style.width = `${Math.round(w)}px`;
    this.canvas.style.height = `${Math.round(h)}px`;
  }

  resetTracking() {
    this.fPos.reset();
    this.fQuat.reset();
    this.fScale.reset();
    this.metrics.reset();
    this.lastPose = null;
  }

  // ---------------------------------------------------------------- frames & materials
  async loadFrame(entry, finishes) {
    let rec = this.cache.get(entry.id);
    if (!rec) {
      const gltf = await this.loader.loadAsync(`${BASE}${entry.model}`);
      const root = gltf.scene;
      const slots = { frame: [], temple: [], lens: [], metal: [], tip: [], pad: [] };
      const temples = {};
      root.traverse((o) => {
        if (o.name === "Temple_L" || o.name === "Temple_R") temples[o.name] = o;
        if (!o.isMesh) return;
        o.castShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          const key = (m.name || "").split(".")[0];
          (slots[key] ||= []).push({ mesh: o, mat: m });
          m.envMapIntensity = 1.0;
        });
        if (o.name.startsWith("Lens")) o.castShadow = false;
      });
      for (const t of Object.values(temples)) t.userData.rest = t.rotation.y;
      rec = { root, slots, temples, entry };
      this.cache.set(entry.id, rec);
    }
    if (this.current) this.mount.remove(this.current.root);
    this.current = rec;
    this.mount.add(rec.root);
    this.applyFinish(rec.entry.finish, finishes);
    this.applyLens(rec.entry.lens || "clear", finishes);
    return rec;
  }

  _replace(slotKey, factory) {
    const list = this.current?.slots[slotKey] || [];
    if (!list.length) return;
    const mat = factory();
    mat.name = slotKey;
    for (const item of list) {
      if (Array.isArray(item.mesh.material)) {
        item.mesh.material = item.mesh.material.map((m) => (m === item.mat ? mat : m));
      } else {
        item.mesh.material = mat;
      }
      item.mat = mat;
    }
  }

  _texture(path) {
    if (!this.textures.has(path)) {
      const t = this.texLoader.load(`${BASE}${path}`);
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false;
      t.anisotropy = 8;
      this.textures.set(path, t);
    }
    return this.textures.get(path);
  }

  finishMaterial(f) {
    const p = { roughness: f.roughness ?? 0.3, metalness: 0, envMapIntensity: 1.0 };
    if (f.kind === "metal") {
      return new THREE.MeshPhysicalMaterial({ ...p, color: f.color, metalness: 1,
        roughness: f.roughness, envMapIntensity: 1.3 });
    }
    if (f.kind === "clear") {
      return new THREE.MeshPhysicalMaterial({ ...p, color: f.color, transmission: f.transmission,
        thickness: 0.003, ior: 1.49, clearcoat: 1, clearcoatRoughness: 0.05,
        attenuationColor: new THREE.Color(f.color), attenuationDistance: 0.01 });
    }
    if (f.kind === "tortoise") {
      return new THREE.MeshPhysicalMaterial({ ...p, color: 0xffffff, map: this._texture(f.texture),
        roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.05 });
    }
    return new THREE.MeshPhysicalMaterial({ ...p, color: f.color, clearcoat: (f.coat ?? 1) * 0.7,
      clearcoatRoughness: 0.08, envMapIntensity: 0.7 });
  }

  applyFinish(key, finishes) {
    const f = finishes.finishes[key];
    if (!f || !this.current) return;
    this._replace("frame", () => this.finishMaterial(f));
    this._replace("temple", () => this.finishMaterial(f));
    this.current.finish = key;
  }

  applyLens(key, finishes) {
    const l = finishes.lenses[key] || finishes.lenses.clear;
    const tinted = (l.transmission ?? 1) < 1;
    this._replace("lens", () => new THREE.MeshPhysicalMaterial({
      color: l.color, roughness: 0.02, metalness: 0, transmission: 1, ior: 1.5,
      thickness: 0.0015, specularIntensity: 1, envMapIntensity: tinted ? 1.1 : 0.55,
      attenuationColor: new THREE.Color(l.color), attenuationDistance: tinted ? 0.0012 : 1,
      iridescence: key === "blue-shield" ? 0.45 : key === "clear" ? 0.15 : 0,
      iridescenceIOR: 1.3, iridescenceThicknessRange: [180, 420],
      transparent: false,
    }));
    if (this.current) this.current.lens = key;
  }

  // ---------------------------------------------------------------- per-frame update
  update(result, t = performance.now()) {
    if (!result) {
      this.pivot.visible = false;
      this.faceOccluder.visible = this.faceShadow.visible = false;
      this.lastPose = null;
      return null;
    }
    const P = toPixels(result.landmarks, this.W, this.H, this.P);
    const pose = computePose(P, this.metrics);

    // occluder/shadow face mesh follows raw landmarks
    const pos = this.faceGeo.attributes.position;
    const occ = this.occGeo.attributes.position;
    const back = pose.axes.z.clone().multiplyScalar(-this.occluderInsetMM / pose.mmPerPx);
    for (let i = 0; i < 478 && i < P.length; i++) {
      pos.setXYZ(i, P[i].x, P[i].y, P[i].z);
      occ.setXYZ(i, P[i].x + back.x, P[i].y + back.y, P[i].z + back.z);
    }
    pos.needsUpdate = occ.needsUpdate = true;
    this.faceGeo.computeBoundingSphere();
    this.occGeo.computeBoundingSphere();
    this.faceOccluder.visible = this.faceShadow.visible = true;

    const q = this.fQuat.filter(pose.quat, t);
    const mid = this.fPos.filter(pose.eyeMid, t);
    const mmPerPx = this.fScale.filter(pose.mmPerPx, t);
    const pxPerM = (1000 / mmPerPx) * this.fit.scale;

    this.pivot.visible = !!this.current;
    this.pivot.position.copy(mid);
    this.pivot.quaternion.copy(q);
    this.pivot.scale.setScalar(pxPerM);
    this.mount.position.set(0, this.fit.offsetY / 1000, this.fit.offsetZ / 1000);
    this.mount.rotation.x = THREE.MathUtils.degToRad(this.fit.tilt);

    // head volume behind the face hides temples where they pass behind the head
    const faceW = (this.metrics.faceWidthMM.value ?? pose.faceWidthPx * mmPerPx) / 1000;
    // (sized to the skull: wide as the face, tall enough to cover temples when looking down)
    this.headOccluder.scale.set(faceW * 0.5, 0.15, 0.1);
    this.headOccluder.position.set(0, 0.025, -0.105);
    this.sideOccluder.scale.set(faceW + 0.006, 0.2, 0.18);
    this.sideOccluder.position.set(0, 0.03, -0.025 - 0.09);

    // splay temples so their arms reach the sides of the head
    if (this.current?.temples) {
      const halfFront = (this.current.entry.dims_mm.total_width / 2) / 1000;
      const halfHead = faceW / 2 - 0.002; // arms hug the head and vanish behind it
      const a = THREE.MathUtils.clamp(Math.atan2(halfHead - halfFront, 0.1),
        THREE.MathUtils.degToRad(-6), THREE.MathUtils.degToRad(14)) -
        THREE.MathUtils.degToRad(this.current.entry.angles_deg?.splay ?? 2);
      const { Temple_L: L, Temple_R: R } = this.current.temples;
      if (L) L.rotation.y = (L.userData.rest ?? 0) - a;
      if (R) R.rotation.y = (R.userData.rest ?? 0) + a;
    }

    // key light from above-front so the frame casts a soft shadow on the skin
    this.light.position.set(mid.x + 0.15 * this.W, mid.y + 0.9 * this.H, mid.z + 2500);
    this.light.target.position.copy(mid);

    this.lastPose = { ...pose, mmPerPxSmoothed: mmPerPx, quatSmoothed: q.clone(),
      calibrated: this.metrics.calibrated,
      faceWidthMM: this.metrics.faceWidthMM.value, pdMM: this.metrics.pdMM.value };
    return this.lastPose;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** PNG data URL of the current view, mirrored like the on-screen preview. */
  snapshot(mirror = true) {
    this.render();
    const src = this.renderer.domElement;
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext("2d");
    if (mirror) {
      g.translate(c.width, 0);
      g.scale(-1, 1);
    }
    g.drawImage(src, 0, 0);
    return c.toDataURL("image/jpeg", 0.92);
  }
}
