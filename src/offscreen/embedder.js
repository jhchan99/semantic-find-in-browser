import { env, pipeline } from "@huggingface/transformers";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const DIMS = 384;

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = false;
env.localModelPath = withSlash(chrome.runtime.getURL("models/"));

if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = withSlash(chrome.runtime.getURL("wasm/"));
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
}

/** @param {string} url */
function withSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

const DEFAULT_BUFFER_MB = 128;

/** @type {Awaited<ReturnType<typeof pipeline>> | null} */
let extractor = null;
/** @type {Promise<Awaited<ReturnType<typeof pipeline>>> | null} */
let loading = null;
/** @type {"webgpu" | "wasm" | "unknown"} */
let device = "unknown";
/** @type {{ defaultMB: number, adapterMB: number, deviceMB: number } | null} */
let gpuLimits = null;
/** @type {Map<number, Float32Array>} */
const indexes = new Map();

function bufferMB() {
  return gpuLimits?.deviceMB ?? 0;
}

/** @param {number} bytes */
function toMB(bytes) {
  return Math.round(Number(bytes) / 1024 / 1024);
}

function clearInjectedDevice() {
  const webgpu = env.backends?.onnx?.webgpu;
  if (!webgpu) return;
  try {
    webgpu.device = undefined;
  } catch {
    // ORT may reject clearing after a failed session.
  }
}

/**
 * One adapter, one device, injected before the first ORT session.
 * @returns {Promise<boolean>}
 */
async function installWebGpuDevice() {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) return false;
  const webgpu = env.backends?.onnx?.webgpu;
  if (!webgpu) throw new Error("onnx webgpu env missing");
  /** @type {string[]} */
  const requiredFeatures = [];
  if (adapter.features.has("shader-f16")) requiredFeatures.push("shader-f16");
  const gpuDevice = await adapter.requestDevice({
    requiredFeatures,
  });
  webgpu.device = gpuDevice;
  gpuLimits = {
    defaultMB: DEFAULT_BUFFER_MB,
    adapterMB: toMB(adapter.limits.maxStorageBufferBindingSize),
    deviceMB: toMB(gpuDevice.limits.maxStorageBufferBindingSize),
  };
  return true;
}

async function loadWasmExtractor() {
  extractor = await pipeline("feature-extraction", MODEL_ID, {
    device: "wasm",
    dtype: "q8",
  });
  device = "wasm";
  gpuLimits = null;
  return extractor;
}

function loadExtractor() {
  if (extractor) return Promise.resolve(extractor);
  loading ??= (async () => {
    if (globalThis.navigator?.gpu) {
      let injected = false;
      try {
        injected = await installWebGpuDevice();
        if (!injected) throw new Error("no gpu adapter");
        extractor = await pipeline("feature-extraction", MODEL_ID, {
          device: "webgpu",
          dtype: "fp16",
        });
        device = "webgpu";
        return extractor;
      } catch (error) {
        console.warn("[sfb] WebGPU MiniLM with injected device failed", error);
        if (injected) clearInjectedDevice();
        gpuLimits = null;
        try {
          extractor = await pipeline("feature-extraction", MODEL_ID, {
            device: "webgpu",
            dtype: "fp16",
          });
          device = "webgpu";
          gpuLimits = {
            defaultMB: DEFAULT_BUFFER_MB,
            adapterMB: DEFAULT_BUFFER_MB,
            deviceMB: DEFAULT_BUFFER_MB,
          };
          return extractor;
        } catch (retryError) {
          console.warn("[sfb] WebGPU MiniLM failed, using WASM q8", retryError);
        }
      }
    }
    return loadWasmExtractor();
  })();
  return loading;
}

/**
 * @param {unknown} pipe
 * @param {string[]} texts
 * @returns {Promise<Float32Array>}
 */
async function runEmbed(pipe, texts) {
  const output = await /** @type {(t: string[], o: { pooling: string, normalize: boolean }) => Promise<{ data: Float32Array | number[] }>} */ (pipe)(
    texts,
    { pooling: "mean", normalize: true },
  );
  const data = output.data instanceof Float32Array ? output.data : new Float32Array(output.data);
  const expected = texts.length * DIMS;
  if (data.length !== expected) {
    throw new Error(`embed size ${data.length}, expected ${expected}`);
  }
  return new Float32Array(data);
}

/**
 * @param {string[]} texts
 * @returns {Promise<Float32Array>}
 */
async function embed(texts) {
  if (texts.length === 0) return new Float32Array(0);
  const pipe = await loadExtractor();
  try {
    return await runEmbed(pipe, texts);
  } catch (error) {
    if (device === "wasm") throw error;
    console.warn("[sfb] WebGPU embed failed, using WASM q8", error);
    extractor = await pipeline("feature-extraction", MODEL_ID, {
      device: "wasm",
      dtype: "q8",
    });
    device = "wasm";
    gpuLimits = null;
    return await runEmbed(extractor, texts);
  }
}

/**
 * @param {number} tabId
 */
function indexHas(tabId) {
  const matrix = indexes.get(tabId);
  if (!matrix) return { n: 0, bytes: 0, device, dims: DIMS, bufferMB: bufferMB() };
  return { n: matrix.length / DIMS, bytes: matrix.byteLength, device, dims: DIMS, bufferMB: bufferMB() };
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
 * @param {number} n
 */
function indexBegin(tabId, n) {
  indexes.set(tabId, new Float32Array(n * DIMS));
}

/**
 * @param {number} tabId
 * @param {string[]} texts
 * @param {number} batchSize
 * @param {(done: number, total: number) => void} onProgress
 */
async function indexPage(tabId, texts, batchSize, onProgress) {
  const n = texts.length;
  const size = batchSize > 0 ? batchSize : 256;
  indexBegin(tabId, n);
  const matrix = indexes.get(tabId);
  if (!matrix) throw new Error(`no index for tab ${tabId}`);
  /** @type {number[]} */
  const batchMs = [];
  onProgress(0, n);
  for (let i = 0; i < n; i += size) {
    const slice = texts.slice(i, i + size);
    const t0 = performance.now();
    const values = await embed(slice);
    matrix.set(values, i * DIMS);
    batchMs.push(Math.round(performance.now() - t0));
    onProgress(Math.min(i + size, n), n);
  }
  return {
    n,
    bytes: n * DIMS * 4,
    device,
    dims: DIMS,
    batchSize: size,
    batchCount: batchMs.length,
    batchMin: batchMs.length ? Math.min(...batchMs) : 0,
    batchMedian: batchMs.length ? median(batchMs) : 0,
    batchMax: batchMs.length ? Math.max(...batchMs) : 0,
    bufferMB: bufferMB(),
  };
}

/**
 * @param {number} tabId
 */
function indexDrop(tabId) {
  indexes.delete(tabId);
  return { dropped: true };
}

/** @type {chrome.runtime.Port | null} */
let port = null;

function connect() {
  port = chrome.runtime.connect({ name: "sfb-offscreen" });
  port.onMessage.addListener((message) => {
    const id = message?.id;
    (async () => {
      if (message?.type === "warmup") {
        await embed(["warmup"]);
        console.log("[sfb] gpu", gpuLimits ?? { device });
        port?.postMessage({ id, device, dims: DIMS, bufferMB: bufferMB() });
        return;
      }
      const tabId = Number(message?.tabId);
      if (message?.type === "index-has") {
        port?.postMessage({ id, ...indexHas(tabId) });
        return;
      }
      if (message?.type === "index-page") {
        const result = await indexPage(
          tabId,
          Array.isArray(message.texts) ? message.texts : [],
          Number(message.batchSize) || 256,
          (done, total) => {
            port?.postMessage({ id, progress: true, done, total, device });
          },
        );
        port?.postMessage({ id, ...result });
        return;
      }
      if (message?.type === "index-drop") {
        port?.postMessage({ id, ...indexDrop(tabId) });
        return;
      }
      throw new Error(`unknown offscreen message ${message?.type}`);
    })().catch((error) => {
      port?.postMessage({ id, error: String(error?.message ?? error) });
    });
  });
  port.onDisconnect.addListener(() => {
    port = null;
    void chrome.runtime.lastError;
    setTimeout(connect, 100);
  });
}

connect();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "sfb-offscreen-hello") return;
  if (!port) connect();
  sendResponse({ ok: true });
});
