// libs/usage-parser.js - Shared utility for parsing Gemini usage page HTML/text

/**
 * Parses the raw innerText/textContent of the Gemini usage page to extract current and weekly usage info.
 * @param {string} fullText The raw text content of the page.
 * @param {object} fallbackData Fallback usage data to retain if parsing fails.
 * @returns {object|null} The parsed usage data, or null if input is invalid.
 */
function parseUsageText(fullText, fallbackData = {}) {
  if (!fullText) return null;

  const lowerText = fullText.toLowerCase();
  
  // "주간 사용량", "주간 한도", "주간" 또는 "weekly limit", "weekly" 단어로 영역을 나눔
  let weeklyIdx = lowerText.indexOf("주간 사용량");
  if (weeklyIdx === -1) weeklyIdx = lowerText.indexOf("주간 한도");
  if (weeklyIdx === -1) weeklyIdx = lowerText.indexOf("주간");
  if (weeklyIdx === -1) weeklyIdx = lowerText.indexOf("weekly limit");
  if (weeklyIdx === -1) weeklyIdx = lowerText.indexOf("weekly");

  // "현재 사용량", "현재" 또는 "current usage", "current" 위치
  let currentIdx = lowerText.indexOf("현재 사용량");
  if (currentIdx === -1) currentIdx = lowerText.indexOf("현재");
  if (currentIdx === -1) currentIdx = lowerText.indexOf("current usage");
  if (currentIdx === -1) currentIdx = lowerText.indexOf("current");

  let currentPart = "";
  let weeklyPart = "";

  if (weeklyIdx !== -1) {
    if (currentIdx !== -1 && currentIdx < weeklyIdx) {
      currentPart = fullText.substring(currentIdx, weeklyIdx);
    } else {
      currentPart = fullText.substring(0, weeklyIdx);
    }
    weeklyPart = fullText.substring(weeklyIdx);
  } else {
    currentPart = fullText;
    weeklyPart = "";
  }

  // 1. 현재 사용량 수치 파싱
  let currentVal = fallbackData.current || "14%";
  const currentMatch = currentPart.match(/(\d+)\s*%\s*(?:사용됨|used|consumed)/i) || 
                       currentPart.match(/(\d+)\s*%/i);
  if (currentMatch) {
    currentVal = currentMatch[1] + "%";
  }

  // 2. 주간 사용량 수치 파싱
  let weeklyVal = fallbackData.weekly || "3%";
  if (weeklyPart) {
    const weeklyMatch = weeklyPart.match(/(\d+)\s*%\s*(?:사용됨|used|consumed)/i) || 
                        weeklyPart.match(/(\d+)\s*%/i);
    if (weeklyMatch) {
      weeklyVal = weeklyMatch[1] + "%";
    }
  }

  // 3. 현재 사용량 초기화 시각 파싱
  let currentReset = fallbackData.currentReset || "오후 7:23에 초기화";
  const currentResetMatch = currentPart.match(/오[전후]\s*\d{1,2}:\d{2}(?:\s*에\s*초기화)?/i) ||
                            currentPart.match(/(?:resets|reset)\s*at\s*오[전후]\s*\d{1,2}:\d{2}/i) ||
                            currentPart.match(/(?:resets\s*at\s*)?\d{1,2}:\d{2}\s*(?:am|pm)/i);
  if (currentResetMatch) {
    let rawReset = currentResetMatch[0];
    if (rawReset.toLowerCase().includes("reset")) {
      rawReset = rawReset.replace(/resets?\s*at\s*/i, "").trim();
    }
    currentReset = rawReset.includes("초기화") ? rawReset : rawReset + "에 초기화";
  }

  // 4. 주간 사용량 초기화 시각 파싱
  let weeklyReset = fallbackData.weeklyReset || "7월 29일 오전 10:23에 초기화";
  if (weeklyPart) {
    const weeklyResetMatch = weeklyPart.match(/\d+월\s*\d+일\s*오[전후]\s*\d{1,2}:\d{2}(?:\s*에\s*초기화)?/i) ||
                             weeklyPart.match(/(?:resets|reset)\s*at\s*.*?\d{1,2}:\d{2}\s*(?:am|pm)/i) ||
                             weeklyPart.match(/오[전후]\s*\d{1,2}:\d{2}(?:\s*에\s*초기화)?/i) ||
                             weeklyPart.match(/(?:resets\s*at\s*)?\d{1,2}:\d{2}\s*(?:am|pm)/i);
    if (weeklyResetMatch) {
      let rawReset = weeklyResetMatch[0];
      if (rawReset.toLowerCase().includes("reset")) {
        rawReset = rawReset.replace(/resets?\s*at\s*/i, "").trim();
      }
      weeklyReset = rawReset.includes("초기화") ? rawReset : rawReset + "에 초기화";
    }
  }

  return {
    plan: fallbackData.plan || "PRO",
    current: currentVal,
    weekly: weeklyVal,
    currentReset: currentReset,
    weeklyReset: weeklyReset,
    updatedAt: Date.now()
  };
}

// Export for ES6 modules if running in module context, or attach to global scope
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseUsageText };
} else if (typeof globalThis !== "undefined") {
  globalThis.parseUsageText = parseUsageText;
} else {
  window.parseUsageText = parseUsageText;
}
