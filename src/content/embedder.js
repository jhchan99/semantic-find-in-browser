const DIMS = 384;
const PORT_NAME = "sfb-embed";

let nextId = 1;
/** @type {chrome.runtime.Port | null} */
let port = null;
/** @type {"webgpu" | "wasm" | "unknown"} */
export let embedDevice = "unknown";

function getPort() {
  if (port) return port;
  port = chrome.runtime.connect({ name: PORT_NAME });
  port.onDisconnect.addListener(() => {
    port = null;
  });
  return port;
}

/**
 * @param {Record<string, unknown>} payload
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<{ n?: number, bytes?: number, device?: string, dims?: number, batchSize?: number, batchCount?: number, batchMin?: number, batchMedian?: number, batchMax?: number, bufferMB?: number }>}
 */
function request(payload, onProgress) {
  return new Promise((resolve, reject) => {
    const p = getPort();
    const id = nextId++;
    const finish = () => {
      p.onMessage.removeListener(onMessage);
      p.onDisconnect.removeListener(onDisconnect);
    };
    /** @param {{ id?: number, error?: string, progress?: boolean, done?: number, total?: number, n?: number, bytes?: number, device?: string, dims?: number, batchSize?: number, batchCount?: number, batchMin?: number, batchMedian?: number, batchMax?: number }} msg */
    const onMessage = (msg) => {
      if (msg.id !== id) return;
      if (msg.progress) {
        if (msg.device === "webgpu" || msg.device === "wasm") embedDevice = msg.device;
        onProgress?.(msg.done ?? 0, msg.total ?? 0);
        return;
      }
      finish();
      if (msg.error) {
        reject(new Error(msg.error));
        return;
      }
      if (msg.device === "webgpu" || msg.device === "wasm") embedDevice = msg.device;
      resolve(msg);
    };
    const onDisconnect = () => {
      finish();
      reject(new Error("embed port disconnected"));
    };
    p.onMessage.addListener(onMessage);
    p.onDisconnect.addListener(onDisconnect);
    p.postMessage({ ...payload, id });
  });
}

/**
 * @returns {Promise<{ n: number, bytes: number, device: string, dims: number }>}
 */
export async function hasIndex() {
  const result = await request({ type: "index-has" });
  return {
    n: result.n ?? 0,
    bytes: result.bytes ?? 0,
    device: embedDevice,
    dims: result.dims ?? DIMS,
  };
}

/**
 * Embed page texts into the offscreen matrix. Does not return vectors.
 *
 * @param {string[]} texts
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function indexPage(texts, onProgress) {
  const n = texts.length;
  const batchSize = 256;
  onProgress?.(0, n);
  const result = await request({ type: "index-page", texts, batchSize }, onProgress);
  return {
    n: result.n ?? n,
    dims: result.dims ?? DIMS,
    bytes: result.bytes ?? n * DIMS * 4,
    device: embedDevice,
    batchSize: result.batchSize ?? batchSize,
    batchCount: result.batchCount ?? 0,
    batchMin: result.batchMin ?? 0,
    batchMedian: result.batchMedian ?? 0,
    batchMax: result.batchMax ?? 0,
    bufferMB: result.bufferMB ?? 0,
  };
}

export { DIMS };
