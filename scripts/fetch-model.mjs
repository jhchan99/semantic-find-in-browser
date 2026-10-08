import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const DEST = join(ROOT, "models", MODEL_ID);
const BASE = `https://huggingface.co/${MODEL_ID}/resolve/main`;

const FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "vocab.txt",
  "onnx/model_fp16.onnx",
  "onnx/model_quantized.onnx",
];

const headers = {
  "User-Agent": "semantic-find-in-browser/0.1 (local fetch-model)",
};

async function download(file) {
  const url = `${BASE}/${file}`;
  const dest = join(DEST, file);
  await mkdir(dirname(dest), { recursive: true });
  console.log(`[sfb] fetching ${file}`);
  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`[sfb] wrote ${file} (${buf.length} bytes)`);
}

for (const file of FILES) {
  await download(file);
}
console.log(`[sfb] model ready at models/${MODEL_ID}/`);
