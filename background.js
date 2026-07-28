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

  // 초기 폴더 구조 셋업 (더미 chatId 제거)
  chrome.storage.sync.get(["folders"], (result) => {
    const initialFolders = [
      {
        id: "folder_work",
        name: "업무",
        color: "#3B82F6",
        parentId: null,
        children: ["folder_gsitm", "folder_uemura", "folder_ai"],
        chatIds: []
      },
      {
        id: "folder_gsitm",
        name: "GSITM",
        color: "#6EE7B7",
        parentId: "folder_work",
        children: [],
        chatIds: []
      },
      {
        id: "folder_uemura",
        name: "우에무라",
        color: "#93C5FD",
        parentId: "folder_work",
        children: ["folder_business_plan"],
        chatIds: []
      },
      {
        id: "folder_business_plan",
        name: "사업계획",
        color: "#FBBF24",
        parentId: "folder_uemura",
        children: [],
        chatIds: []
      },
      {
        id: "folder_ai",
        name: "AI",
        color: "#C084FC",
        parentId: "folder_work",
        children: [],
        chatIds: []
      }
    ];

    if (!result.folders || result.folders.length === 0) {
      chrome.storage.sync.set({ folders: initialFolders }, () => {
        console.log("Clean initial folders set without dummy chatIds.");
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
