/** Same id as `HOST_ID` in find-bar.js — keep this module free of `chrome.*`. */
const HOST_ID = "semantic-finder-host";

const SKIP_TAGS = new Set(["script", "style", "noscript", "textarea", "svg", "canvas"]);

const BLOCK_TAGS = new Set([
  "p",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "td",
  "th",
  "tr",
  "blockquote",
  "pre",
  "dt",
  "dd",
  "article",
  "section",
  "figcaption",
]);

const MIN_CHARS = 20;
const WINDOW_MIN = 80;
const WINDOW_MAX = 200;
const YIELD_NODES = 2000;
const YIELD_MS = 8;

/**
 * @typedef {{
 *   id: number,
 *   text: string,
 *   startNode: Text,
 *   startOffset: number,
 *   endNode: Text,
 *   endOffset: number,
 * }} Chunk
 *
 * @typedef {{
 *   chunks: Chunk[],
 *   textNodes: number,
 *   yielded: number,
 *   ms: number,
 * }} ChunkResult
 *
 * @typedef {{ node: Text, text: string }} Piece
 */

/**
 * @param {Node} [root]
 * @returns {Promise<ChunkResult>}
 */
export async function chunkDocument(root = document.body) {
  /** @type {Chunk[]} */
  const chunks = [];
  const empty = { chunks, textNodes: 0, yielded: 0, ms: 0 };
  if (!root) return empty;

  const started = performance.now();
  let textNodes = 0;
  let yielded = 0;
  let nextId = 0;
  /** @type {Element | null} */
  let lastKey = null;
  /** @type {Piece[]} */
  let group = [];
  let nodesSinceYield = 0;
  let sliceStart = performance.now();

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = /** @type {Element} */ (node);
        if (SKIP_TAGS.has(el.localName) || el.id === HOST_ID) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      }
      const text = /** @type {Text} */ (node);
      return text.data && /\S/.test(text.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const flush = () => {
    if (group.length === 0) return;
    nextId = emitChunks(chunks, group, nextId);
    group = [];
  };

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = /** @type {Text} */ (node);
    textNodes += 1;
    const key = blockAncestor(text, root);
    if (key !== lastKey) {
      flush();
      lastKey = key;
    }
    group.push({ node: text, text: text.data });

    nodesSinceYield += 1;
    if (nodesSinceYield >= YIELD_NODES || performance.now() - sliceStart > YIELD_MS) {
      yielded += 1;
      await yieldToMain();
      nodesSinceYield = 0;
      sliceStart = performance.now();
    }
  }
  flush();

  return {
    chunks,
    textNodes,
    yielded,
    ms: performance.now() - started,
  };
}

/**
 * @param {ChunkResult} result
 */
export function logChunks(result) {
  const chars = result.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  console.log("[sfb] chunked", {
    ms: Math.round(result.ms),
    textNodes: result.textNodes,
    chunks: result.chunks.length,
    chars,
    yielded: result.yielded,
  });
  if (result.chunks.length === 0) {
    console.log("[sfb] no text nodes were accepted (likely a non-HTML surface)");
    return;
  }
  console.table(sampleRows(result.chunks));
  Object.assign(globalThis, { __sfbChunks: result.chunks });
}

/**
 * @param {Text} node
 * @param {Node} root
 * @returns {Element | null}
 */
function blockAncestor(node, root) {
  let el = node.parentElement;
  /** @type {Element | null} */
  let divFallback = null;
  while (el && el !== root) {
    if (BLOCK_TAGS.has(el.localName)) return el;
    if (el.localName === "div" && !divFallback) divFallback = el;
    el = el.parentElement;
  }
  return divFallback ?? node.parentElement;
}

/**
 * @param {Chunk[]} chunks
 * @param {Piece[]} pieces
 * @param {number} nextId
 */
function emitChunks(chunks, pieces, nextId) {
  const raw = pieces.map((piece) => piece.text).join("");
  for (const window of packWindows(raw)) {
    const text = window.text.replace(/\s+/g, " ").trim();
    if (text.length < MIN_CHARS) continue;
    const start = locate(pieces, window.start, "start");
    const end = locate(pieces, window.end, "end");
    chunks.push({
      id: nextId,
      text,
      startNode: start.node,
      startOffset: start.offset,
      endNode: end.node,
      endOffset: end.offset,
    });
    nextId += 1;
  }
  return nextId;
}

/**
 * @param {string} raw
 * @returns {{ start: number, end: number, text: string }[]}
 */
function packWindows(raw) {
  /** @type {{ start: number, end: number, text: string }[]} */
  const windows = [];
  let accStart = -1;
  let accEnd = 0;
  let accText = "";

  const flush = () => {
    if (accStart < 0) return;
    windows.push({ start: accStart, end: accEnd, text: accText });
    accStart = -1;
    accEnd = 0;
    accText = "";
  };

  for (const sentence of matchSentences(raw)) {
    if (sentence.text.length > WINDOW_MAX) {
      flush();
      for (let i = sentence.start; i < sentence.end; i += WINDOW_MAX) {
        const end = Math.min(i + WINDOW_MAX, sentence.end);
        windows.push({ start: i, end, text: raw.slice(i, end) });
      }
      continue;
    }
    if (accText.length >= WINDOW_MIN && accText.length + sentence.text.length > WINDOW_MAX) {
      flush();
    }
    if (accStart < 0) accStart = sentence.start;
    accEnd = sentence.end;
    accText += sentence.text;
  }
  flush();
  return windows;
}

/**
 * @param {string} raw
 * @returns {{ start: number, end: number, text: string }[]}
 */
function matchSentences(raw) {
  /** @type {{ start: number, end: number, text: string }[]} */
  const out = [];
  const re = /[^.!?]+(?:[.!?]+["')\]]*)?\s*/g;
  let last = 0;
  let match;
  while ((match = re.exec(raw))) {
    out.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < raw.length) {
    out.push({ start: last, end: raw.length, text: raw.slice(last) });
  }
  return out;
}

/**
 * @param {Piece[]} pieces
 * @param {number} charOffset
 * @param {"start" | "end"} side
 */
function locate(pieces, charOffset, side) {
  let remaining = charOffset;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    const len = piece.text.length;
    const atEnd = remaining === len && (side === "end" || i === pieces.length - 1);
    if (remaining < len || atEnd) {
      return { node: piece.node, offset: remaining };
    }
    remaining -= len;
  }
  const last = pieces[pieces.length - 1];
  return { node: last.node, offset: last.text.length };
}

/**
 * @param {Chunk[]} chunks
 */
function sampleRows(chunks) {
  const rows = (chunks.length <= 12 ? chunks : pickSample(chunks)).map((chunk) => ({
    id: chunk.id,
    chars: chunk.text.length,
    preview: chunk.text.slice(0, 80),
  }));
  return rows;
}

/**
 * @param {Chunk[]} chunks
 */
function pickSample(chunks) {
  const mid = Math.max(4, Math.floor(chunks.length / 2) - 2);
  return [...chunks.slice(0, 4), ...chunks.slice(mid, mid + 4), ...chunks.slice(-4)];
}

function yieldToMain() {
  const sch = /** @type {{ scheduler?: { yield?: () => Promise<void> } }} */ (globalThis).scheduler;
  if (typeof sch?.yield === "function") return sch.yield();
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
