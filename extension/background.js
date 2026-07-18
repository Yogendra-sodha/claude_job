// background.js
// Runs in the extension background to avoid CORS and Mixed Content issues on job pages.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchExtensionData') {
    fetch('http://localhost:3000/api/data/extension')
      .then(res => {
        if (!res.ok) throw new Error('Server not OK');
        return res.json();
      })
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }
});
