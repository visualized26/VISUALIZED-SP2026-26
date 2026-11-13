// UI panels (left catalog + right tools). Pure DOM, driven by the store.
import { CATEGORIES, filterModels } from "../core/catalog.js";
import { SHAPES } from "../core/faceShape.js";
import { ADVICE } from "../core/recommend.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const LABEL = (k) => k.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ------------------------------------------------------------------ left panel
export function mountCatalog(store, actions) {
  const cats = $("#categories");
  cats.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (b) store.set({ category: b.dataset.cat });
  });
  $("#search").addEventListener("input", (e) => store.set({ query: e.target.value }));
  $("#frameGrid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-model]");
    if (b) actions.selectModel(b.dataset.model);
  });

  let lastCats = "", lastGrid = "";
  const render = (s) => {
    // a "Matches" category appears once there are recommendations
    const catList = s.recommended.length ? [CATEGORIES[0], ["match", "✦ Matches"], ...CATEGORIES.slice(1)] : CATEGORIES;
    const catKey = JSON.stringify([catList.length, s.category]);
    if (catKey !== lastCats) {
      lastCats = catKey;
      cats.innerHTML = catList.map(([k, l]) =>
        `<button class="cat ${k === "match" ? "cat-match" : ""} ${k === s.category ? "active" : ""}" data-cat="${k}">${l}</button>`).join("");
    }
    // redraw the grid only when what it shows changes (not on every pose update)
    const gridKey = JSON.stringify([s.models.length, s.category, s.query, s.modelId, s.favorites, s.recommended]);
    if (gridKey === lastGrid) return;
    lastGrid = gridKey;
    const list = filterModels(s.models, s);
    const rec = new Set(s.recommended || []);
    $("#frameGrid").innerHTML = list.length
      ? list.map((m) => `
        <button class="frame-card ${m.id === s.modelId ? "active" : ""}" data-model="${m.id}" title="${esc(m.name)}">
          <img src="${m.preview}" alt="${esc(m.name)} ${esc(m.style)} glasses" loading="lazy" />
          <span class="frame-name">${esc(m.name)}${s.favorites.includes(m.id) ? ' <i class="heart">♥</i>' : ""}</span>
          <span class="frame-meta">${LABEL(m.style)}${rec.has(m.id) ? ' · <b class="match">Match</b>' : ""}</span>
        </button>`).join("")
      : `<p class="muted">No frames match your search.</p>`;
  };
  store.subscribe(render);
  render(store.get());
}

// ------------------------------------------------------------------ right panel
const TOOLS = [
  ["fit", "Smart Fit Analysis", "View estimated measurements and fit results.",
    '<path d="M4 8V5h3M20 8V5h-3M4 16v3h3M20 16v3h-3" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/>'],
  ["shape", "Face Shape", "View your estimated face shape.",
    '<circle cx="12" cy="7" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 20c0-3.5 2.7-6 6-6s6 2.5 6 6" fill="none" stroke="currentColor" stroke-width="2"/>'],
  ["custom", "Customization", "Frame color, lens type and options.",
    '<path d="M4 7h10M18 7h2M4 17h4M12 17h8" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="10" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="2"/>'],
  ["recs", "Recommendations", "Discover suitable frame styles.",
    '<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="currentColor"/>'],
];

export function mountTools(store, actions) {
  const root = $("#tools");
  root.innerHTML = TOOLS.map(([k, title, sub, icon]) => `
    <section class="tool" data-tool="${k}">
      <button class="tool-head" data-toggle="${k}">
        <svg viewBox="0 0 24 24" width="20" height="20">${icon}</svg>
        <span><strong>${title}</strong><small>${sub}</small></span>
      </button>
      <div class="tool-body" id="tool-${k}"></div>
    </section>`).join("");

  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-toggle]");
    if (t) {
      const k = t.dataset.toggle;
      store.set((s) => ({ openTool: s.openTool === k ? null : k }));
      return;
    }
    const a = e.target.closest("[data-act]");
    if (!a) return;
    const { act, val } = a.dataset;
    if (act === "size") actions.selectSize(val);
    if (act === "finish") actions.selectFinish(val);
    if (act === "lens") actions.selectLens(val);
    if (act === "resetFit") actions.resetFit();
    if (act === "model") actions.selectModel(val);
    if (act === "tryRec") actions.tryRecommendation(val, a.dataset.size);
    if (act === "showMatches") actions.showMatches();
    if (act === "rescan") actions.rescanShape();
  });
  root.addEventListener("input", (e) => {
    const r = e.target.closest("[data-fit]");
    if (r) actions.setFit(r.dataset.fit, parseFloat(r.value));
  });

  let lastKey = "", lastShape = "", lastRecs = "";
  const render = (s) => {
    root.querySelectorAll(".tool").forEach((el) => el.classList.toggle("open", el.dataset.tool === s.openTool));
    // customization re-renders only when its inputs change (keeps sliders usable)
    const m = s.models.find((x) => x.id === s.modelId);
    const key = JSON.stringify([s.modelId, s.size, s.finish, s.lens]);
    if (m && key !== lastKey) {
      lastKey = key;
      $("#tool-custom").innerHTML = customizationHTML(s, m);
    }
    $("#tool-fit").innerHTML = fitHTML(s, m);
    // analysis panels redraw only when their result changes
    const shapeKey = JSON.stringify([s.faceShape?.shape, Math.round((s.faceShape?.confidence ?? 0) * 100),
      s.faceShape ? 0 : s.source, s.faceShape ? 0 : Math.min(s.pose?.faceShapeSamples ?? 0, 12)]);
    if (shapeKey !== lastShape) {
      lastShape = shapeKey;
      $("#tool-shape").innerHTML = shapeHTML(s);
    }
    const recKey = JSON.stringify([s.recs.map((r) => r.id + r.size), s.modelId, s.size, !!s.faceShape]);
    if (recKey !== lastRecs) {
      lastRecs = recKey;
      $("#tool-recs").innerHTML = recsHTML(s);
    }
  };
  store.subscribe(render);
  render(store.get());
}

function swatch(f) {
  if (!f) return "#888";
  if (f.kind === "tortoise") return `linear-gradient(135deg, #c98a3a, #4a2410 60%, #1e0d06)`;
  return f.color;
}

function customizationHTML(s, m) {
  const fin = s.finishes.finishes;
  const sizes = ["S", "M", "L"].filter((k) => m.sizes[k]);
  return `
    <div class="field"><label>Size</label><div class="seg">
      ${sizes.map((k) => `<button data-act="size" data-val="${k}" class="${k === s.size ? "on" : ""}">${k}
        <small>${m.sizes[k].dims_mm.lens_width}□${m.sizes[k].dims_mm.bridge}</small></button>`).join("")}
    </div></div>
    <div class="field"><label>Frame finish</label><div class="swatches">
      ${m.finishes.map((k) => `<button data-act="finish" data-val="${k}" class="sw ${k === s.finish ? "on" : ""}"
        title="${LABEL(k)}" style="background:${swatch(fin[k])}"></button>`).join("")}
    </div><small class="muted">${LABEL(s.finish || "")}</small></div>
    <div class="field"><label>Lens</label><div class="chips">
      ${Object.keys(s.finishes.lenses).map((k) => `<button data-act="lens" data-val="${k}" class="chip ${k === s.lens ? "on" : ""}">${LABEL(k)}</button>`).join("")}
    </div></div>
    <details class="field"><summary>Fine-tune fit (optional - placement is automatic)</summary>
      ${slider("offsetY", "Height", -5, 5, 0.1, s.fit.offsetY, "mm")}
      ${slider("offsetZ", "Distance from face", -4, 6, 0.1, s.fit.offsetZ, "mm")}
      ${slider("tilt", "Tilt", 0, 16, 0.5, s.fit.tilt, "°")}
      ${slider("scale", "Size correction", 0.9, 1.1, 0.005, s.fit.scale, "×")}
      <button class="chip" data-act="resetFit">Reset</button>
    </details>`;
}

function slider(key, label, min, max, step, val, unit) {
  return `<label class="slider"><span>${label}</span>
    <input type="range" data-fit="${key}" min="${min}" max="${max}" step="${step}" value="${val}" />
    <em>${unit}</em></label>`;
}

function fitHTML(s, m) {
  const v = m?.sizes[s.size];
  const p = s.pose;
  if (!v) return "";
  const d = v.dims_mm;
  const rows = [
    ["Frame (lens □ bridge – temple)", `${d.lens_width} □ ${d.bridge} – ${d.temple_length}`],
    ["Frame total width", `${d.total_width} mm`],
  ];
  let verdict = `<p class="muted">Start the camera and look straight ahead to estimate your measurements.</p>`;
  if (p?.faceWidthMM) {
    rows.push(["Your face width (est.)", `${p.faceWidthMM.toFixed(0)} mm`]);
    rows.push(["Your pupillary distance (est.)", `${p.pdMM.toFixed(1)} mm`]);
    const diff = d.total_width - p.faceWidthMM;
    const [cls, txt] = diff < -6 ? ["warn", "Looks narrow for your face"]
      : diff > 9 ? ["warn", "Looks wide for your face"] : ["ok", "Width looks suitable"];
    verdict = `<div class="verdict ${cls}">${txt}</div>
      <p class="muted small">${p.calibrated ? "" : "Calibrating... "}Estimates from your webcam using the average iris size (11.7 mm).
      Not a substitute for a professional measurement. Full Smart Fit comes in the next build step.</p>`;
  }
  return `<table class="kv">${rows.map(([k, v2]) => `<tr><th>${k}</th><td>${v2}</td></tr>`).join("")}</table>${verdict}`;
}

const PCT = (p) => `${Math.round(p * 100)}%`;
const UNCERTAIN = 0.4;

function shapeHTML(s) {
  const fs = s.faceShape;
  if (!fs) {
    const n = Math.min(s.pose?.faceShapeSamples ?? 0, 12);
    const how = s.source === "none"
      ? "Start the camera or upload a front-facing photo."
      : "Look straight at the camera with a neutral expression and your hair away from your face.";
    return `<p class="muted">${how}</p>
      ${s.source === "camera" ? `<div class="meter"><i style="width:${(n / 12) * 100}%"></i></div>
      <p class="muted small">Measuring... ${n}/12 frontal frames</p>` : ""}`;
  }
  const top = fs.ranked[0];
  const unsure = top.p < UNCERTAIN || top.p - fs.ranked[1].p < 0.1;
  const f = fs.features;
  return `
    <div class="shape-result">
      <strong>${LABEL(top.shape)}</strong> <span class="conf">${PCT(top.p)}</span>
      ${unsure ? `<div class="verdict warn">Uncertain. Your face is between ${LABEL(top.shape)} and ${LABEL(fs.ranked[1].shape)}.</div>` : ""}
    </div>
    <div class="bars">
      ${fs.ranked.map((r) => `<div class="bar"><span>${LABEL(r.shape)}</span><i><b style="width:${r.p * 100}%"></b></i><em>${PCT(r.p)}</em></div>`).join("")}
    </div>
    <details class="field"><summary>How this was measured</summary>
      <table class="kv">
        <tr><th>Face length ÷ cheekbone width</th><td>${f.length.toFixed(2)}</td></tr>
        <tr><th>Forehead ÷ cheekbones</th><td>${f.forehead.toFixed(2)}</td></tr>
        <tr><th>Jaw ÷ cheekbones</th><td>${f.jaw.toFixed(2)}</td></tr>
        <tr><th>Lower jaw ÷ cheekbones</th><td>${f.chin.toFixed(2)}</td></tr>
      </table>
      <p class="muted small">Proportions from ${fs.samples} frontal frames, compared with MediaPipe's average face.</p>
    </details>
    <p class="muted small">An estimate from facial landmarks, not yet validated. Hair, lighting and expression
      can change it. Use it as a starting point.</p>
    <button class="chip" data-act="rescan">Measure again</button>`;
}

function recsHTML(s) {
  const fs = s.faceShape;
  if (!fs) {
    return `<p class="muted">Recommendations appear once your face shape has been estimated
      (open <b>Face Shape</b> and look at the camera). Every frame stays available to browse.</p>`;
  }
  const byId = new Map(s.models.map((m) => [m.id, m]));
  const items = s.recs.map((r) => {
    const m = byId.get(r.id);
    const active = r.id === s.modelId && r.size === s.size;
    return `<div class="rec ${r.id === s.modelId ? "active" : ""}">
      <img src="${m.preview}" alt="" loading="lazy" />
      <div><strong>${esc(m.name)}</strong>
        <small>${LABEL(m.style)} · suits ${m.faceShapes.filter((x) => SHAPES.includes(x)).map(LABEL).join(", ")}</small>
        <small>${r.sizeFit != null ? `Size ${r.size} fits your face width` : `Size ${r.size}`}</small></div>
      <button class="chip ${active ? "on" : ""}" data-act="tryRec" data-val="${r.id}" data-size="${r.size}">${active ? "Wearing" : "Try"}</button>
    </div>`;
  }).join("");
  return `
    <p><b>For ${LABEL(fs.shape)} faces:</b> ${ADVICE[fs.shape]}</p>
    <div class="recs">${items || `<p class="muted">No strong matches. Every style is worth a try.</p>`}</div>
    ${s.recs.length ? `<button class="chip" data-act="showMatches">Show matches in the frame list</button>` : ""}
    <p class="muted small">Recommendations are starting points. Personal taste matters too.</p>`;
}
