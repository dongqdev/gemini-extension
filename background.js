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
});

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
});
