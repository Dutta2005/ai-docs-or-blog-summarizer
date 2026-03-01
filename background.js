chrome.commands.onCommand.addListener(async (command) => {
  if (command === "summarize-page") {
    await chrome.storage.session.set({ autoSummarize: true });
    try {
      await chrome.action.openPopup();
    } catch (error) {
      await chrome.storage.session.remove("autoSummarize");
      console.error("Failed to open extension popup for summarize-page command", error);
    }
  }
});
