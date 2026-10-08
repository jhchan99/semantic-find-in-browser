import * as esbuild from "esbuild";
import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "node_modules/@huggingface/transformers/dist");
const WASM_DIR = join(ROOT, "wasm");

await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: ["src/offscreen/embedder.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: "src/offscreen/embedder.bundle.js",
  legalComments: "none",
  logLevel: "info",
});

await mkdir(WASM_DIR, { recursive: true });
const names = await readdir(DIST);
let copied = 0;
for (const name of names) {
  if (!name.startsWith("ort-") || !/\.(wasm|mjs)$/.test(name)) continue;
  await cp(join(DIST, name), join(WASM_DIR, name));
  copied += 1;
}
if (copied === 0) {
  throw new Error(`no .wasm/.mjs files in ${DIST}`);
}
console.log(`[sfb] copied ${copied} onnx runtime files to wasm/`);
