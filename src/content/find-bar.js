export const HOST_ID = "semantic-finder-host";

/**
 * @typedef {{
 *   matchCase: boolean,
 *   wholeWord: boolean,
 *   meaning: boolean
 * }} FindOptions
 *
 * @typedef {{
 *   onQuery: (query: string) => void,
 *   onNavigate: (direction: 1 | -1) => void,
 *   onOptions: (options: FindOptions) => void,
 *   onClose: () => void
 * }} FindBarHandlers
 */

const STYLE_URL = chrome.runtime.getURL("src/content/find-bar.css");

/**
 * @param {FindBarHandlers} handlers
 */
export async function createFindBar(handlers) {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;overflow:visible;";
    document.documentElement.append(host);
  }

  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  shadow.innerHTML = "";

  const css = await fetch(STYLE_URL).then((res) => res.text());
  const style = document.createElement("style");
  style.textContent = css;

  const bar = document.createElement("div");
  bar.className = "sfb-bar";
  bar.setAttribute("role", "search");
  bar.hidden = true;

  const input = document.createElement("input");
  input.className = "sfb-input";
  input.type = "search";
  input.placeholder = "Find in page";
  input.setAttribute("aria-label", "Find in page");
  input.autocomplete = "off";
  input.spellcheck = false;

  const count = document.createElement("div");
  count.className = "sfb-count";
  count.setAttribute("aria-live", "polite");
  count.textContent = "0 of 0";

  /**
   * @param {string} label
   * @param {string} title
   * @param {() => void} onClick
   * @param {string} [extraClass]
   */
  function button(label, title, onClick, extraClass = "sfb-btn") {
    const el = document.createElement("button");
    el.type = "button";
    el.className = extraClass;
    el.textContent = label;
    el.title = title;
    el.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return el;
  }

  const prev = button("↑", "Previous match (Shift+Enter)", () => handlers.onNavigate(-1));
  const next = button("↓", "Next match (Enter)", () => handlers.onNavigate(1));

  /**
   * @param {keyof FindOptions} opt
   * @param {string} label
   * @param {string} title
   */
  function toggle(opt, label, title) {
    const el = button(label, title, () => {
      const pressed = el.getAttribute("aria-pressed") === "true";
      el.setAttribute("aria-pressed", pressed ? "false" : "true");
      handlers.onOptions(readOptions());
    }, "sfb-toggle");
    el.dataset.opt = opt;
    el.setAttribute("aria-pressed", "false");
    return el;
  }

  const matchCase = toggle("matchCase", "Aa", "Match case");
  const wholeWord = toggle("wholeWord", "ab", "Match whole word");
  const meaning = toggle("meaning", "≈", "Match meaning (hybrid)");
  const close = button("×", "Close (Esc)", () => handlers.onClose(), "sfb-btn sfb-close");

  function readOptions() {
    return {
      matchCase: matchCase.getAttribute("aria-pressed") === "true",
      wholeWord: wholeWord.getAttribute("aria-pressed") === "true",
      meaning: meaning.getAttribute("aria-pressed") === "true",
    };
  }

  input.addEventListener("input", () => handlers.onQuery(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handlers.onNavigate(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      handlers.onClose();
    }
  });

  bar.append(input, count, prev, next, matchCase, wholeWord, meaning, close);
  shadow.append(style, bar);

  return {
    host,
    get query() {
      return input.value;
    },
    set query(value) {
      input.value = value;
    },
    readOptions,
    /**
     * @param {FindOptions} options
     */
    setOptions(options) {
      matchCase.setAttribute("aria-pressed", String(options.matchCase));
      wholeWord.setAttribute("aria-pressed", String(options.wholeWord));
      meaning.setAttribute("aria-pressed", String(options.meaning));
    },
    /**
     * @param {{ current: number, total: number, exact: number, related: number, meaning: boolean }} state
     */
    setStatus(state) {
      const current = state.total === 0 ? 0 : state.current + 1;
      count.innerHTML = "";
      count.append(`${current} of ${state.total}`);
      if (state.meaning) {
        const sub = document.createElement("small");
        sub.textContent = `${state.exact} exact · ${state.related} related`;
        count.append(sub);
      }
      prev.disabled = state.total === 0;
      next.disabled = state.total === 0;
    },
    open() {
      bar.hidden = false;
      input.focus();
      input.select();
    },
    close() {
      bar.hidden = true;
      input.blur();
    },
    isOpen() {
      return !bar.hidden;
    },
    focus() {
      input.focus();
      input.select();
    },
  };
}
