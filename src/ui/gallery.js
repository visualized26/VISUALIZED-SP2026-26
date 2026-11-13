// Gallery dialog: saved multi-angle sets (3 photos each), grouped and downloadable.
import { ANGLES, deleteSet, listSets, lookbookBlob } from "../core/gallery.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let urls = [];

function revoke() {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
}
function objUrl(blob) {
  const u = URL.createObjectURL(blob);
  urls.push(u);
  return u;
}

export async function refreshGalleryCount() {
  const n = (await listSets()).length;
  $("#galleryCount").textContent = n || "";
  return n;
}

export async function openGallery({ onTryFrame } = {}) {
  const dlg = $("#dialog");
  const sets = await listSets();
  revoke();
  dlg.innerHTML = `
    <div class="dlg-head">
      <h2>Gallery</h2>
      <button class="chip" data-close>Close</button>
    </div>
    <p class="muted small">Your multi-angle sets are stored only in this browser on this device.</p>
    ${sets.length ? "" : `<div class="empty">No sets yet. Capture Left, Front and Right in the
      Multi-Angle Try-On, then press <b>Save set to Gallery</b>.</div>`}
    <div class="sets">
      ${sets.map((s) => `
        <article class="set" data-id="${s.id}">
          <div class="set-shots">
            ${ANGLES.map((a) => `<figure><img src="${objUrl(s.shots[a])}" alt="${a} view" data-view="${a}" />
              <figcaption>${a[0].toUpperCase() + a.slice(1)}</figcaption></figure>`).join("")}
          </div>
          <div class="set-meta">
            <div><strong>${esc(s.frame.name)}</strong> · Size ${esc(s.frame.size)} · ${esc(s.frame.finishName)}
              <div class="muted small">${new Date(s.createdAt).toLocaleString()}</div></div>
            <div class="set-actions">
              <button class="chip" data-act="try">Try this frame</button>
              <button class="chip" data-act="download">Download</button>
              <button class="chip danger" data-act="delete">Delete</button>
            </div>
          </div>
        </article>`).join("")}
    </div>
    <div class="viewer" id="viewer" hidden><img alt="" /></div>`;

  dlg.onclick = async (e) => {
    if (e.target.closest("[data-close]") || e.target === dlg) {
      dlg.close();
      return;
    }
    const viewer = $("#viewer");
    if (e.target.closest("#viewer")) {
      viewer.hidden = true;
      return;
    }
    const img = e.target.closest("img[data-view]");
    if (img) {
      viewer.querySelector("img").src = img.src;
      viewer.hidden = false;
      return;
    }
    const btn = e.target.closest("[data-act]");
    const card = e.target.closest(".set");
    if (!btn || !card) return;
    const set = sets.find((s) => s.id === card.dataset.id);
    if (btn.dataset.act === "delete") {
      if (!confirm("Delete this set of 3 photos? This cannot be undone.")) return;
      await deleteSet(set.id);
      card.remove();
      refreshGalleryCount();
    } else if (btn.dataset.act === "download") {
      const blob = await lookbookBlob(set);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `visualized-${set.frame.modelId}-${new Date(set.createdAt).toISOString().slice(0, 10)}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } else if (btn.dataset.act === "try") {
      dlg.close();
      onTryFrame?.(set.frame);
    }
  };
  dlg.onclose = revoke;
  dlg.showModal();
}
