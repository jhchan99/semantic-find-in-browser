import { DIMS, embed } from "./minilm.js";

/** @type {Map<number, Float32Array>} */
const indexes = new Map();

/**
 * @param {number} tabId
 * @param {number} n
 */
function begin(tabId, n) {
  indexes.set(tabId, new Float32Array(n * DIMS));
}

/**
 * @param {number} tabId
 * @param {number} offset
 * @param {Float32Array} values
 */
function write(tabId, offset, values) {
  const matrix = indexes.get(tabId);
  if (!matrix) throw new Error(`no index for tab ${tabId}`);
  matrix.set(values, offset);
}

/**
 * @param {number} tabId
 */
export function has(tabId) {
  const matrix = indexes.get(tabId);
  if (!matrix) return { n: 0, bytes: 0, dims: DIMS };
  return { n: matrix.length / DIMS, bytes: matrix.byteLength, dims: DIMS };
}

/**
 * @param {number[]} values
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * @param {number} tabId
 * @param {string[]} texts
 * @param {number} batchSize
 * @param {(done: number, total: number) => void} onProgress
 */
export async function indexPage(tabId, texts, batchSize, onProgress) {
  const n = texts.length;
  const size = batchSize > 0 ? batchSize : 256;
  begin(tabId, n);
  /** @type {number[]} */
  const batchMs = [];
  onProgress(0, n);
  for (let i = 0; i < n; i += size) {
    const slice = texts.slice(i, i + size);
    const t0 = performance.now();
    const values = await embed(slice);
    write(tabId, i * DIMS, values);
    batchMs.push(Math.round(performance.now() - t0));
    onProgress(Math.min(i + size, n), n);
  }
  return {
    n,
    bytes: n * DIMS * 4,
    dims: DIMS,
    batchSize: size,
    batchCount: batchMs.length,
    batchMin: batchMs.length ? Math.min(...batchMs) : 0,
    batchMedian: batchMs.length ? median(batchMs) : 0,
    batchMax: batchMs.length ? Math.max(...batchMs) : 0,
  };
}

/**
 * @param {number} tabId
 */
export function drop(tabId) {
  indexes.delete(tabId);
  return { dropped: true };
}
