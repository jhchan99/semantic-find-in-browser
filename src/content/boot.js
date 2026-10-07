import { FindController } from "./controller.js";
import { highlightsSupported } from "./highlights.js";

const controller = new FindController();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "toggle-find") {
    controller.toggle();
  }
});

window.addEventListener(
  "keydown",
  (event) => {
    const key = event.key.toLowerCase();
    const openShortcut = event.altKey && !event.ctrlKey && !event.metaKey && key === "f";
    if (openShortcut) {
      event.preventDefault();
      event.stopPropagation();
      controller.toggle();
      return;
    }

    if (!controller.bar?.isOpen()) return;

    if (event.key === "Escape") {
      event.preventDefault();
      controller.close();
      return;
    }

    if (event.key === "F3") {
      event.preventDefault();
      controller.navigate(event.shiftKey ? -1 : 1);
    }
  },
  true,
);

if (!highlightsSupported()) {
  console.warn("Semantic Finder: CSS Custom Highlight API is not available in this tab.");
}
