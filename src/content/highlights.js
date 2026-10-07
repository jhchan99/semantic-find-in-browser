const EXACT = "sfb-exact";
const RELATED = "sfb-related";
const CURRENT = "sfb-current";

export function highlightsSupported() {
  return typeof CSS !== "undefined" && Boolean(CSS.highlights);
}

/**
 * @param {string} name
 * @param {Range[]} ranges
 */
function setHighlight(name, ranges) {
  if (!highlightsSupported()) return;
  CSS.highlights.delete(name);
  if (ranges.length === 0) return;
  CSS.highlights.set(name, new Highlight(...ranges));
}

/**
 * @param {{
 *   exact?: Range[],
 *   related?: Range[],
 *   current?: Range | null
 * }} layers
 */
export function applyHighlights(layers) {
  setHighlight(EXACT, layers.exact ?? []);
  setHighlight(RELATED, layers.related ?? []);
  setHighlight(CURRENT, layers.current ? [layers.current] : []);
}

export function clearHighlights() {
  if (!highlightsSupported()) return;
  CSS.highlights.delete(EXACT);
  CSS.highlights.delete(RELATED);
  CSS.highlights.delete(CURRENT);
}
