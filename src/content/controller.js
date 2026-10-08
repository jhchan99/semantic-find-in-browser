import { chunkDocument, logChunks } from "./chunker.js";
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
    if (this.chunks) return;
    this.chunking ??= chunkDocument().then((result) => {
      this.chunks = result.chunks;
      logChunks(result);
      return result;
    });
    await this.chunking;
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
