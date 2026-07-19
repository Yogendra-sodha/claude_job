// background.js
// 1) Proxies API fetches for frames that can't reach localhost directly.
// 2) Relays a "fill" broadcast to every frame in the tab, so clicking the ⚡
//    in the outer page also fills forms living inside embedded iframes
//    (Greenhouse embeds, Workday sub-frames, etc.).

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

  if (request.action === 'fillAllFrames' && sender.tab && sender.tab.id != null) {
    // Delivered to the content script in EVERY frame of the tab
    chrome.tabs.sendMessage(sender.tab.id, { action: 'jf-fill', nonce: request.nonce })
      .catch(() => { /* some frames may have no listener — fine */ });
  }
});
