/*
 * Offscreen document: parses product page HTML fetched by the service worker
 * (which has no DOMParser) with the same extractor the content script uses.
 * Scripts inside the parsed HTML never run: DOMParser documents are inert.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'parse') return false;
  if (sender.id !== chrome.runtime.id) return false;
  try {
    const doc = new DOMParser().parseFromString(String(msg.html || ''), 'text/html');
    sendResponse(PTExtract.extract(doc, msg.url, { freshPage: true }));
  } catch (_) {
    sendResponse(null);
  }
  return false;
});
