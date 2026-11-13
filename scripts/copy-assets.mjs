// Copies runtime assets out of node_modules so the site is fully self-hosted
// (GitHub Pages friendly, no third-party CDNs for code): MediaPipe WASM + Draco decoder.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jobs = [
  ["node_modules/@mediapipe/tasks-vision/wasm", "public/vendor/mediapipe-wasm"],
  ["node_modules/three/examples/jsm/libs/draco/gltf", "public/vendor/draco"],
];
for (const [from, to] of jobs) {
  const src = join(root, from);
  if (!existsSync(src)) {
    console.error(`[assets] missing ${from} - run npm install`);
    process.exit(1);
  }
  mkdirSync(join(root, to), { recursive: true });
  cpSync(src, join(root, to), { recursive: true });
  console.log(`[assets] ${from} -> ${to}`);
}
