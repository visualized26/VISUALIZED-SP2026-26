// Gallery of multi-angle photo sets, stored only in this browser (IndexedDB).
// A set = { id, createdAt, frame: {modelId, name, size, finish, lens}, shots: {left, right, front} (Blobs) }
const DB = "visualized";
const STORE = "sets";
export const ANGLES = ["left", "front", "right"];

let dbPromise = null;
let memory = []; // fallback when IndexedDB is unavailable (private mode etc.)

function open() {
  if (!("indexedDB" in window)) return Promise.reject(new Error("no indexedDB"));
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  }));
}

export async function listSets() {
  try {
    const all = await tx("readonly", (s) => s.getAll());
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [...memory].sort((a, b) => b.createdAt - a.createdAt);
  }
}

export async function saveSet(set) {
  const rec = { id: crypto.randomUUID?.() ?? String(Date.now()), createdAt: Date.now(), ...set };
  try {
    await tx("readwrite", (s) => s.put(rec));
    return { rec, persistent: true };
  } catch {
    memory.push(rec);
    return { rec, persistent: false };
  }
}

export async function deleteSet(id) {
  try {
    await tx("readwrite", (s) => s.delete(id));
  } catch {
    /* fall through */
  }
  memory = memory.filter((r) => r.id !== id);
}

export function dataUrlToBlob(url) {
  const [head, b64] = url.split(",");
  const mime = head.match(/:(.*?);/)[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** One wide image with the three shots side by side + a caption (for download). */
export async function lookbookBlob(set) {
  const imgs = await Promise.all(ANGLES.map(async (a) => {
    const bmp = await createImageBitmap(set.shots[a]);
    return bmp;
  }));
  const h = 480;
  const ws = imgs.map((b) => Math.round((b.width / b.height) * h));
  const pad = 16, cap = 56;
  const c = document.createElement("canvas");
  c.width = ws.reduce((a, b) => a + b, 0) + pad * 4;
  c.height = h + pad * 2 + cap;
  const g = c.getContext("2d");
  g.fillStyle = "#101014";
  g.fillRect(0, 0, c.width, c.height);
  let x = pad;
  imgs.forEach((b, i) => {
    g.drawImage(b, x, pad, ws[i], h);
    g.fillStyle = "rgba(0,0,0,.55)";
    g.fillRect(x, pad + h - 30, 80, 30);
    g.fillStyle = "#fff";
    g.font = "600 16px system-ui, sans-serif";
    g.fillText(ANGLES[i][0].toUpperCase() + ANGLES[i].slice(1), x + 10, pad + h - 10);
    x += ws[i] + pad;
  });
  g.fillStyle = "#e9e3ff";
  g.font = "700 22px system-ui, sans-serif";
  const f = set.frame;
  g.fillText(`VISUALIZED · ${f.name} (${f.size}) · ${f.finishName}`, pad, h + pad + 38);
  g.fillStyle = "#a1a1aa";
  g.font = "16px system-ui, sans-serif";
  const date = new Date(set.createdAt).toLocaleString();
  g.fillText(date, c.width - pad - g.measureText(date).width, h + pad + 38);
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
}
