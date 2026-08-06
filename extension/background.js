// background.js
// 1) Proxies API fetches for frames that can't reach localhost directly.
// 2) Relays a "fill" broadcast to every frame in the tab, so clicking the ⚡
//    in the outer page also fills forms living inside embedded iframes
//    (Greenhouse embeds, Workday sub-frames, etc.).

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchExtensionData') {
    // Fetch from the background (service worker) context, NOT the page — a public
    // site like job-boards.greenhouse.io is blocked by Chrome's Private Network
    // Access policy from reaching 127.0.0.1 directly, but the extension can.
    // Use 127.0.0.1 to match the server's bind address (avoids localhost->::1).
    fetch('http://127.0.0.1:3000/api/data/extension')
      .then(res => {
        if (!res.ok) throw new Error('server returned ' + res.status);
        return res.json();
      })
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }

  if (request.action === 'gptFill') {
    // Proxy the AI question-answering call (same loopback/PNA reason as above).
    fetch('http://127.0.0.1:3000/api/gpt-fill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: request.questions || [] }),
    })
      .then(res => res.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'fillAllFrames' && sender.tab && sender.tab.id != null) {
    // Delivered to the content script in EVERY frame of the tab
    chrome.tabs.sendMessage(sender.tab.id, { action: 'jf-fill', nonce: request.nonce })
      .catch(() => { /* some frames may have no listener — fine */ });
  }

  if (request.action === 'reviewAllFrames' && sender.tab && sender.tab.id != null) {
    // Broadcast the 🤖 review trigger to every frame (the form often lives in one)
    chrome.tabs.sendMessage(sender.tab.id, { action: 'jf-review', nonce: request.nonce })
      .catch(() => { /* some frames may have no listener — fine */ });
  }
});
