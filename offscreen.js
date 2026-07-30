// offscreen.js - Scrapes and parses Gemini usage page in background DOM context

document.addEventListener("DOMContentLoaded", () => {
  const fetchUrl = `https://gemini.google.com/usage?hl=ko&t=${Date.now()}`;
  console.log("[Offscreen] Starting fetch to Gemini usage page:", fetchUrl);

  fetch(fetchUrl, {
    credentials: "include",
    cache: "no-store",
    headers: {
      "Pragma": "no-cache",
      "Cache-Control": "no-cache"
    }
  })
    .then((response) => {
      if (!response.ok) throw new Error("HTTP error " + response.status);
      return response.text();
    })
    .then((html) => {
      console.log("[Offscreen] Fetch successful. Parsing HTML...");
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const fullText = doc.body ? (doc.body.innerText || doc.body.textContent || "") : html;

      console.log("[Offscreen] Text extracted, sending to background for processing.");
      chrome.runtime.sendMessage({ action: "usageTextExtracted", text: fullText });
    })
    .catch((err) => {
      console.error("[Offscreen] Fetch error:", err);
      chrome.runtime.sendMessage({ action: "fetchFailed", error: err.message });
    });
});
