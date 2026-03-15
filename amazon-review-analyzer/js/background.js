// ============================================================
// Amazon Review Analyzer Pro — background.js (Service Worker)
// ============================================================

// Open popup when message received from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openPopup') {
    chrome.action.openPopup();
  }
});

// Set badge when on Amazon product page
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const isAmazon = /amazon\.(com|in|co\.uk|de|fr|ca|com\.au)/i.test(tab.url);
    const isProduct = /\/dp\/|\/gp\/product\//i.test(tab.url);

    if (isAmazon && isProduct) {
      chrome.action.setBadgeText({ text: '★', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#FF6B35', tabId });
    } else if (isAmazon) {
      chrome.action.setBadgeText({ text: '', tabId });
    } else {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  }
});
