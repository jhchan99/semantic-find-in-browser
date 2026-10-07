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
