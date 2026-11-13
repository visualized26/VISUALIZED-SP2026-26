// UI panels (left catalog + right tools). Pure DOM, driven by the store.
import { CATEGORIES, filterModels } from "../core/catalog.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const LABEL = (k) => k.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ------------------------------------------------------------------ left panel
export function mountCatalog(store, actions) {
  const cats = $("#categories");
  cats.innerHTML = CATEGORIES.map(([k, l]) => `<button class="cat" data-cat="${k}">${l}</button>`).join("");
  cats.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (b) store.set({ category: b.dataset.cat });
  });
  $("#search").addEventListener("input", (e) => store.set({ query: e.target.value }));
  $("#frameGrid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-model]");
    if (b) actions.selectModel(b.dataset.model);
  });

  const render = (s) => {
    cats.querySelectorAll(".cat").forEach((b) => b.classList.toggle("active", b.dataset.cat === s.category));
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
  });
  root.addEventListener("input", (e) => {
    const r = e.target.closest("[data-fit]");
    if (r) actions.setFit(r.dataset.fit, parseFloat(r.value));
  });

  let lastKey = "";
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
    $("#tool-shape").innerHTML = `<p class="muted">Face-shape estimation is part of the next build step.</p>`;
    $("#tool-recs").innerHTML = recsHTML(s);
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

function recsHTML(s) {
  return `<p class="muted">Recommendations based on your face shape arrive with the face-shape step.
    Meanwhile every frame is tagged with the face shapes it usually suits.</p>`;
}
