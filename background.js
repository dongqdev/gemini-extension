// background.js - Gemini Extension Service Worker

// 확장 프로그램 설치 또는 업데이트 시 초기 셋업
chrome.runtime.onInstalled.addListener(() => {
  console.log("Gemini Extension installed or updated.");

  // 기본 제미나이 DOM 셀렉터 규칙 초기화 (동적 변경 대비)
  const defaultSelectors = {
    inputAreaContainer: ".input-area-container, .textarea-container, div.input-area",
    textarea: "div[contenteditable='true'], textarea#textarea, textarea",
    sendButton: "button.send-button-container, button[aria-label*='전송'], button[aria-label*='Send']",
    chatStreamContainer: "div.chat-history, .conversation-container, main div.chat-history, .chat-view",
    messageBlock: "message-content, .message-content-container, div.message-row, .message-content",
    userPromptText: ".user-query, .query-text, div.user-query-container",
    modelResponseText: ".model-response, .response-container, div.model-response-container, .markdown",
    sidebarContainer: "nav, .left-sidebar-navigation, g-sidenav, .sidebar",
    sidebarChatList: "div.recent-chats-container, .recent-chats, nav.left-sidebar-navigation div.recent",
    chatItemAnchor: "a[href*='/app/'], a[href*='/c/']"
  };

  chrome.storage.local.set({ selectors: defaultSelectors }, () => {
    console.log("Default selectors initialized in chrome.storage.local");
  });

  // 초기 폴더 구조 셋업 (빈 배열로 초기화)
  chrome.storage.sync.get(["folders"], (result) => {
    if (!result.folders) {
      chrome.storage.sync.set({ folders: [] }, () => {
        console.log("Empty initial folders set.");
      });
    }
  });

  // 초기 사용량 데이터 세팅
  const today = new Date().toISOString().split("T")[0];
  chrome.storage.local.get(["usageData"], (result) => {
    if (!result.usageData) {
      chrome.storage.local.set({
        usageData: {
          currentDate: today,
          dailyCount: 0,
          weeklyCount: 0,
          history: {}
        }
      });
    }
  });

  // 10분 주기 사용량 백그라운드 수집 알람 등록
  chrome.alarms.create("fetchUsageAlarm", { periodInMinutes: 10 });
  console.log("fetchUsageAlarm registered.");

  // 초기 시작 시 강제 1회 수집 시도
  startBackgroundUsageFetch().catch((err) => console.warn("[Background] Initial fetch skipped:", err.message));
});

// 백그라운드 임시 탭 생명주기 관리 변수
let activeUsageFetchTabId = null;
let isFetchingUsage = false;
let fetchTimeoutTimer = null;
let activeUsageFetchCallback = null;

/**
 * 임시 탭 자원 정리 및 닫기
 */
function cleanupFetchTab(targetTabId = null) {
  if (fetchTimeoutTimer) {
    clearTimeout(fetchTimeoutTimer);
    fetchTimeoutTimer = null;
  }
  const tabId = targetTabId || activeUsageFetchTabId;
  if (tabId !== null) {
    if (tabId === activeUsageFetchTabId) {
      activeUsageFetchTabId = null;
    }
    chrome.tabs.remove(tabId, () => {
      // 탭이 이미 수동이나 다른 원인으로 닫혔을 때 발생하는 에러 무시
      if (chrome.runtime.lastError) { /* ignore */ }
    });
  }
  isFetchingUsage = false;
  activeUsageFetchCallback = null;
}

/**
 * 탭의 로드가 완료되면 직접 스크래핑을 하도록 지시하는 핸들러
 */
function handleTabUpdate(tabId, changeInfo, tab) {
  if (tabId === activeUsageFetchTabId && changeInfo.status === "complete") {
    console.log("[Background] Temporary usage tab load complete. Sending scrape request to tab:", tabId);
    
    // 페이지 로드 완료 후 200ms 대기하여 스크립트 실행의 기회를 확보
    setTimeout(() => {
      if (activeUsageFetchTabId !== tabId) return;
      chrome.tabs.sendMessage(tabId, { action: "scrapeUsageDirectly" }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[Background] Error sending scrape message to temp tab:", chrome.runtime.lastError.message);
        } else {
          console.log("[Background] Tab scraping trigger response:", response);
        }
      });
    }, 200);
  }
}

// 탭 업데이트 수신기 등록
chrome.tabs.onUpdated.addListener(handleTabUpdate);

// 백그라운드 알람 수신기
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "fetchUsageAlarm") {
    console.log("[Background] Alarm fired. Triggering background usage fetch...");
    startBackgroundUsageFetch().catch((err) => console.error("Alarm fetch trigger failed:", err));
  }
});

/**
 * 백그라운드에서 임시 비활성 탭을 생성하여 사용량을 정밀 파싱하고 자동 수거합니다.
 */
async function startBackgroundUsageFetch() {
  if (isFetchingUsage) {
    console.log("[Background] Usage fetch already in progress. Skipping.");
    return { status: "already_running" };
  }

  isFetchingUsage = true;
  console.log("[Background] Starting background tab usage fetch...");

  return new Promise((resolve, reject) => {
    activeUsageFetchCallback = (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    };

    chrome.tabs.create(
      {
        url: "https://gemini.google.com/usage?hl=ko",
        active: false,
        pinned: true
      },
      (tab) => {
        if (chrome.runtime.lastError || !tab) {
          isFetchingUsage = false;
          activeUsageFetchCallback = null;
          reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : "Failed to create tab"));
          return;
        }
        activeUsageFetchTabId = tab.id;
        console.log("[Background] Temporary tab created for usage fetch. ID:", tab.id);

        // 15초 타임아웃 방지책
        fetchTimeoutTimer = setTimeout(() => {
          console.warn("[Background] Scrape process timed out. Closing temporary tab...");
          if (activeUsageFetchCallback) {
            activeUsageFetchCallback(new Error("Scrape process timed out"));
          }
          cleanupFetchTab();
        }, 15000);
      }
    );
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === "updateSelectors") {
    chrome.storage.local.set({ selectors: message.selectors }, () => {
      sendResponse({ status: "success", message: "Selectors updated successfully." });
    });
    return true;
  }
  
  if (message.action === "getSelectors") {
    chrome.storage.local.get(["selectors"], (result) => {
      sendResponse({ selectors: result.selectors });
    });
    return true;
  }

  // 사용량 수집 완료/실패 처리 (임시 탭 내부 스크래핑 결과)
  if (message.action === "usageScraped") {
    console.log("[Background] Usage scraped successfully.", message.data);
    if (activeUsageFetchCallback) {
      activeUsageFetchCallback(null, message.data);
    }
    const closeTabId = (sender && sender.tab && sender.tab.id) ? sender.tab.id : null;
    cleanupFetchTab(closeTabId);
    return false;
  }

  if (message.action === "usageScrapeFailed") {
    console.error("[Background] Usage scrape failed:", message.error);
    if (activeUsageFetchCallback) {
      activeUsageFetchCallback(new Error(message.error));
    }
    const closeTabId = (sender && sender.tab && sender.tab.id) ? sender.tab.id : null;
    cleanupFetchTab(closeTabId);
    return false;
  }

  // 온디맨드 수집 요청 (Popup / Floating Widget / Chat Send)
  if (message.action === "requestFetchUsage") {
    console.log("[Background] On-demand usage fetch requested.");
    startBackgroundUsageFetch()
      .then((data) => {
        sendResponse({ status: "success", data: data });
      })
      .catch((err) => {
        console.error("[Background] On-demand fetch failed:", err);
        sendResponse({ status: "error", error: err.message });
      });
    return true; // 비동기 응답 처리 유지
  }
});
