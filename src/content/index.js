// Classic content-script entry. Chrome often ignores "type": "module" here,
// so static import fails. Dynamic import() of an extension URL is a module.
(async () => {
  try {
    await import(chrome.runtime.getURL("src/content/boot.js"));
  } catch (error) {
    console.error("Semantic Finder failed to start", error);
  }
})();
