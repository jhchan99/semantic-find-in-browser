import { chunkDocument, logChunks } from "./chunker.js";
import { hasIndex, indexPage } from "./embedder.js";
import { createFindBar } from "./find-bar.js";
import { clearHighlights } from "./highlights.js";

const OPTIONS_KEY = "sfb-options";

const DEFAULT_OPTIONS = {
  matchCase: false,
  wholeWord: false,
  meaning: true,
};

export class FindController {
  constructor() {
    /** @type {Awaited<ReturnType<typeof createFindBar>> | null} */
    this.bar = null;
    /** @type {import("./chunker.js").Chunk[] | null} */
    this.chunks = null;
    /** @type {Promise<import("./chunker.js").ChunkResult> | null} */
    this.chunking = null;
    this.indexed = false;
    /** @type {Promise<void> | null} */
    this.embedding = null;
    this.options = { ...DEFAULT_OPTIONS };
    this.ready = this.init();
  }

  async init() {
    const stored = await chrome.storage.local.get(OPTIONS_KEY);
    this.options = { ...DEFAULT_OPTIONS, ...(stored[OPTIONS_KEY] ?? {}) };

    this.bar = await createFindBar({
      onQuery: (query) => this.onQuery(query),
      onNavigate: (direction) => this.navigate(direction),
      onOptions: (options) => this.setOptions(options),
      onClose: () => this.close(),
    });
    this.bar.setOptions(this.options);
    this.syncBar();
  }

  async toggle() {
    await this.ready;
    if (this.bar?.isOpen()) this.close();
    else await this.open();
  }

  async open() {
    await this.ready;
    this.bar?.open();
    this.bar?.setBusy("Reading page…");
    this.chunking ??= chunkDocument().then((result) => {
      this.chunks = result.chunks;
      logChunks(result);
      return result;
    });
    await this.chunking;
    if (this.indexed) {
      const status = await hasIndex();
      if (status.n === (this.chunks?.length ?? 0)) {
        this.syncBar();
        return;
      }
      this.indexed = false;
      this.embedding = null;
    }
    this.embedding ??= this.embedChunks().catch((error) => {
      this.embedding = null;
      this.indexed = false;
      this.bar?.setBusy("Embed failed");
      console.error("[sfb] embed failed", error);
      throw error;
    });
    await this.embedding;
  }

  async embedChunks() {
    const chunks = this.chunks ?? [];
    const texts = chunks.map((chunk) => chunk.text);
    const n = texts.length;
    const t0 = performance.now();
    this.bar?.setBusy(n === 0 ? "Indexing…" : `Indexing 0 / ${n}`);
    const result = await indexPage(texts, (done, total) => {
      this.bar?.setBusy(`Indexing ${done} / ${total}`);
    });
    this.indexed = true;
    const ms = Math.round(performance.now() - t0);
    console.log("[sfb] embedded", {
      n: result.n,
      ms,
      device: result.device,
      perSec: ms > 0 ? Math.round((result.n * 1000) / ms) : 0,
      batch: `${result.batchSize} × ${result.batchCount}`,
      batchMs: `${result.batchMin} / ${result.batchMedian} / ${result.batchMax}`,
      bufferMB: result.bufferMB,
    });
    this.syncBar();
  }

  close() {
    this.bar?.close();
    clearHighlights();
  }

  /**
   * @param {typeof DEFAULT_OPTIONS} options
   */
  async setOptions(options) {
    this.options = options;
    await chrome.storage.local.set({ [OPTIONS_KEY]: options });
    this.syncBar();
  }

  /**
   * @param {string} _query
   */
  onQuery(_query) {
    this.syncBar();
  }

  /**
   * @param {1 | -1} _direction
   */
  navigate(_direction) {}

  syncBar() {
    this.bar?.setStatus({
      current: 0,
      total: 0,
      exact: 0,
      related: 0,
      meaning: this.options.meaning,
    });
  }
}
