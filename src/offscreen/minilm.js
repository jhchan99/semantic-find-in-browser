import { env, pipeline } from "@huggingface/transformers";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const DIMS = 384;

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

export function getDevice() {
  return device;
}

export function bufferMB() {
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
export async function embed(texts) {
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

export async function warmup() {
  await embed(["warmup"]);
  console.log("[sfb] gpu", gpuLimits ?? { device });
}
