const OFFSCREEN_URL = "src/offscreen/offscreen.html";
const DIMS = 384;

/** @type {chrome.runtime.Port | null} */
let offscreenPort = null;
/** @type {Promise<void> | null} */
let ensuring = null;
let nextOffscreenId = 1;
/** @type {Map<number, { resolve: (value: any) => void, reject: (error: Error) => void, onProgress?: (msg: any) => void }>} */
const pending = new Map();

async function sendToActiveTab(type) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type });
  } catch {
    // Content script is missing (chrome:// pages, or tab opened before install).
  }
}

chrome.action.onClicked.addListener(() => {
  sendToActiveTab("toggle-find");
});

chrome.commands.onCommand.addListener((command) => {
  sendToActiveTab(command);
});

/**
 * @returns {Promise<boolean>}
 */
function hasOffscreenDocument() {
  if (chrome.offscreen.hasDocument) return chrome.offscreen.hasDocument();
  return chrome.runtime
    .getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })
    .then((contexts) => contexts.length > 0);
}

function waitForOffscreenPort(timeoutMs = 20000) {
  if (offscreenPort) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (offscreenPort) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error("offscreen document did not connect"));
      }
    }, 20);
  });
}

async function createOffscreen() {
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["WORKERS"],
      justification: "Keep MiniLM loaded and embed page text",
    });
  } catch (error) {
    if (!(await hasOffscreenDocument())) throw error;
  }
}

function ensureOffscreen() {
  ensuring ??= (async () => {
    try {
      if (offscreenPort) return;
      if (await hasOffscreenDocument()) {
        try {
          await chrome.runtime.sendMessage({ type: "sfb-offscreen-hello" });
        } catch {
          await chrome.offscreen.closeDocument();
          await createOffscreen();
        }
      } else {
        await createOffscreen();
      }
      try {
        await waitForOffscreenPort(2000);
      } catch {
        if (await hasOffscreenDocument()) await chrome.offscreen.closeDocument();
        await createOffscreen();
        await waitForOffscreenPort();
      }
    } finally {
      ensuring = null;
    }
  })();
  return ensuring;
}

/**
 * @param {string} type
 * @param {Record<string, unknown>} [extra]
 * @param {(msg: any) => void} [onProgress]
 */
function callOffscreen(type, extra = {}, onProgress) {
  return new Promise((resolve, reject) => {
    if (!offscreenPort) {
      reject(new Error("offscreen port missing"));
      return;
    }
    const id = nextOffscreenId++;
    pending.set(id, { resolve, reject, onProgress });
    offscreenPort.postMessage({ type, id, ...extra });
  });
}

async function warmup() {
  await ensureOffscreen();
  await callOffscreen("warmup");
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "sfb-offscreen") {
    offscreenPort = port;
    port.onMessage.addListener((message) => {
      const waiter = pending.get(message?.id);
      if (!waiter) return;
      if (message.progress) {
        waiter.onProgress?.(message);
        return;
      }
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error));
      else waiter.resolve(message);
    });
    port.onDisconnect.addListener(() => {
      if (offscreenPort === port) offscreenPort = null;
      for (const [id, waiter] of pending) {
        waiter.reject(new Error("offscreen disconnected"));
        pending.delete(id);
      }
    });
    return;
  }

  if (port.name === "sfb-embed") {
    const tabId = port.sender?.tab?.id;
    port.onMessage.addListener((message) => {
      if (!message?.type) return;
      (async () => {
        try {
          if (tabId == null) throw new Error("no tab id");
          await ensureOffscreen();
          const result = await callOffscreen(
            message.type,
            {
              tabId,
              texts: message.texts,
              batchSize: message.batchSize,
            },
            (progressMsg) => {
              port.postMessage({
                id: message.id,
                progress: true,
                done: progressMsg.done,
                total: progressMsg.total,
                device: progressMsg.device,
              });
            },
          );
          port.postMessage({
            id: message.id,
            n: result.n,
            bytes: result.bytes,
            device: result.device,
            dims: result.dims ?? DIMS,
            batchSize: result.batchSize,
            batchCount: result.batchCount,
            batchMin: result.batchMin,
            batchMedian: result.batchMedian,
            batchMax: result.batchMax,
            bufferMB: result.bufferMB,
          });
        } catch (error) {
          port.postMessage({
            id: message.id,
            error: String(error?.message ?? error),
          });
        }
      })();
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!offscreenPort) return;
  callOffscreen("index-drop", { tabId }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  warmup().catch((error) => console.error("[sfb] warmup failed", error));
});

chrome.runtime.onStartup.addListener(() => {
  warmup().catch((error) => console.error("[sfb] warmup failed", error));
});
