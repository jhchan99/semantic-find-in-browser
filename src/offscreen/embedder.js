import { drop, has, indexPage } from "./index.js";
import { DIMS, bufferMB, getDevice, warmup } from "./minilm.js";

/** @type {chrome.runtime.Port | null} */
let port = null;

function connect() {
  port = chrome.runtime.connect({ name: "sfb-offscreen" });
  port.onMessage.addListener((message) => {
    const id = message?.id;
    (async () => {
      if (message?.type === "warmup") {
        await warmup();
        port?.postMessage({ id, device: getDevice(), dims: DIMS, bufferMB: bufferMB() });
        return;
      }
      const tabId = Number(message?.tabId);
      if (message?.type === "index-has") {
        port?.postMessage({ id, ...has(tabId), device: getDevice(), bufferMB: bufferMB() });
        return;
      }
      if (message?.type === "index-page") {
        const result = await indexPage(
          tabId,
          Array.isArray(message.texts) ? message.texts : [],
          Number(message.batchSize) || 256,
          (done, total) => {
            port?.postMessage({ id, progress: true, done, total, device: getDevice() });
          },
        );
        port?.postMessage({ id, ...result, device: getDevice(), bufferMB: bufferMB() });
        return;
      }
      if (message?.type === "index-drop") {
        port?.postMessage({ id, ...drop(tabId) });
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
