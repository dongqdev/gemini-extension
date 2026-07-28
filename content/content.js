// content.js - Gemini Extension Core Content Script with Safe Storage Wrapper

let selectors = {};
let currentChatData = { messages: [] };
let intersectionObserver = null;
let mutationObserver = null;

// 폴더 트리 상태 관리 변수
let folders = [];
let expandedFolders = {}; // { folderId: true/false }

// 0. 안전한 Chrome Storage API 래퍼 (콘텍스트 무효화 에러 방지)
function safeStorageLocalGet(keys, callback) {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime && chrome.runtime.lastError) return;
        callback(result || {});
      });
    }
  } catch (e) {}
}

function safeStorageSyncGet(keys, callback) {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(keys, (result) => {
        if (chrome.runtime && chrome.runtime.lastError) return;
        callback(result || {});
      });
    }
  } catch (e) {}
}

function safeStorageLocalSet(data) {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(data);
    }
  } catch (e) {}
}

function safeStorageSyncSet(data, callback) {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(data, () => {
        if (callback) callback();
      });
    }
  } catch (e) {}
}

// 1. 기본 셀렉터 로드 및 초기화
function init() {
  safeStorageLocalGet(["selectors", "expandedFolders"], (result) => {
    selectors = result.selectors || {
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

    expandedFolders = result.expandedFolders || {};

    console.log("Gemini Extension Selectors Loaded:", selectors);

    // DOM 로드 및 주입 실행
    setupExtensionFeatures();
  });
}

// 확장 프로그램 주요 기능들 주입 및 실행
function setupExtensionFeatures() {
  // 기존 TOC 트랙/패널 요소가 남아있는 경우 제거
  const oldTrack = document.getElementById("gemini-tick-track");
  if (oldTrack) oldTrack.remove();
  const oldPanel = document.getElementById("gemini-toc-panel");
  if (oldPanel) oldPanel.remove();
  const oldBtn = document.getElementById("gemini-toc-open-btn");
  if (oldBtn) oldBtn.remove();

  // A. 와이드 모드 드래그 스플리터 주입
  setupResizableSplitter();

  // B. 제미나이 사이드바 폴더 트리 주입
  setupSidebarFolderTree();

  // C. MutationObserver를 통한 대화 내보내기 버튼 및 신규 메시지 추적
  setupMutationObserver();

  // D. 질문 전송 감지 (사용량 카운팅)
  setupUsageTracking();

  // E. 드래그 앤 드롭 플로팅 사용량 위젯 주입 (gemini.google.com/usage 연동)
  setupUsageFloatingWidget();

  // F. 대화창 너비 조절 슬라이드바 컨트롤러 주입 (Chat Width Controller Slider)
  setupChatWidthController();
}

/* ==========================================
   A. 와이드 모드 드래그 스플리터 (Resizable Splitter)
   ========================================== */
function setupResizableSplitter() {
  if (document.getElementById("gemini-resizable-splitter")) return;

  const checkInterval = setInterval(() => {
    const inputArea = document.querySelector(selectors.inputAreaContainer);
    if (inputArea) {
      clearInterval(checkInterval);

      const splitter = document.createElement("div");
      splitter.id = "gemini-resizable-splitter";
      splitter.className = "gemini-drag-handle";
      splitter.innerHTML = `<div class="handle-line"></div>`;

      inputArea.insertBefore(splitter, inputArea.firstChild);

      let isDragging = false;
      let startY = 0;
      let startHeight = 0;

      safeStorageLocalGet(["inputAreaHeight"], (result) => {
        if (result.inputAreaHeight) {
          const textareaWrapper = inputArea.querySelector(".input-area, .textarea-wrapper, .textarea");
          if (textareaWrapper) {
            textareaWrapper.style.height = `${result.inputAreaHeight}px`;
          } else {
            inputArea.style.height = `${result.inputAreaHeight}px`;
          }
        }
      });

      splitter.addEventListener("mousedown", (e) => {
        isDragging = true;
        startY = e.clientY;
        
        const targetElement = inputArea.querySelector(".input-area, .textarea-wrapper, .textarea") || inputArea;
        startHeight = targetElement.offsetHeight;
        
        document.body.classList.add("gemini-resizing");
        e.preventDefault();
      });

      document.addEventListener("mousemove", (e) => {
        if (!isDragging) return;

        const deltaY = startY - e.clientY;
        const newHeight = Math.max(100, Math.min(600, startHeight + deltaY));

        const targetElement = inputArea.querySelector(".input-area, .textarea-wrapper, .textarea") || inputArea;
        targetElement.style.height = `${newHeight}px`;

        safeStorageLocalSet({ inputAreaHeight: newHeight });
      });

      document.addEventListener("mouseup", () => {
        if (isDragging) {
          isDragging = false;
          document.body.classList.remove("gemini-resizing");
        }
      });
    }
  }, 1000);
}

/* ==========================================
   B. 목차(TOC) 패널 및 노션 스타일 틱 마크


/* ==========================================
   C. 제미나이 사이드바 폴더 트리 통합 구현
   ========================================== */
/* ==========================================
   C. 제미나이 사이드바 폴더 트리 통합 구현 (Robust Multi-Modal Finder)
   ========================================== */
function setupSidebarFolderTree() {
  const checkSidebarInterval = setInterval(() => {
    // 이미 사이드바에 폴더 트리가 주입된 경우 스킵
    if (document.getElementById("gemini-sidebar-folders")) return;

    let sidebar = null;
    let targetArea = null;

    // 1. "최근" 또는 "Recent" 텍스트를 가진 헤더/엘리먼트 탐색
    const allElements = Array.from(document.querySelectorAll("div, span, h2, h3, p, g-sidenav"));
    for (let el of allElements) {
      const text = el.innerText ? el.innerText.trim() : "";
      if ((text === "최근" || text === "Recent") && el.children.length <= 1) {
        targetArea = el.closest("div[role='navigation'] > div, nav > div, section, div.recent-chats-container") || el.parentElement;
        sidebar = el.closest("nav, aside, g-sidenav, side-navigation-v2, [role='navigation']") || el.parentElement.parentElement;
        break;
      }
    }

    // 2. 대화 세션 링크 (a[href*='/app/'])를 통한 탐색
    if (!targetArea) {
      const chatAnchor = document.querySelector("a[href*='/app/'], a[href*='/c/']");
      if (chatAnchor) {
        targetArea = chatAnchor.closest("div.recent-chats-container, div.recent, nav > div, ul, section");
        if (!sidebar && targetArea) {
          sidebar = targetArea.closest("nav, aside, g-sidenav, side-navigation-v2, [role='navigation']") || targetArea.parentElement;
        }
      }
    }

    // 3. 셀렉터에 의한 사이드바 탐색
    if (!sidebar) {
      sidebar = document.querySelector(selectors.sidebarContainer || "nav, aside, g-sidenav, side-navigation-v2, [role='navigation']");
    }

    if (sidebar || targetArea) {
      const foldersContainer = document.createElement("div");
      foldersContainer.id = "gemini-sidebar-folders";
      foldersContainer.className = "gemini-sidebar-folders-container";
      
      foldersContainer.innerHTML = `
        <div class="gemini-folders-header">
          <span class="gemini-folders-header-title">Folders</span>
          <div class="gemini-folders-header-actions">
            <button class="gemini-folders-action-btn btn-toggle-all" title="전체 펼치기/접기">↕</button>
            <button class="gemini-folders-action-btn btn-add-root" title="루트 폴더 추가">➕</button>
          </div>
        </div>
        <ul id="gemini-sidebar-folder-tree-root" class="gemini-sidebar-folder-tree">
          <div class="empty-state">폴더 데이터를 읽어오는 중...</div>
        </ul>
        <div id="gemini-folder-modal" class="gemini-folder-modal-overlay hidden">
          <div class="gemini-folder-modal-content">
            <h4>폴더 추가/수정</h4>
            <input type="text" id="gemini-modal-folder-name" placeholder="폴더명을 입력하세요">
            <div class="modal-buttons">
              <button id="gemini-modal-cancel" class="btn btn-secondary">취소</button>
              <button id="gemini-modal-save" class="btn btn-primary">저장</button>
            </div>
            <input type="hidden" id="gemini-modal-parent-id">
            <input type="hidden" id="gemini-modal-edit-id">
          </div>
        </div>
      `;

      // 타겟 위치 바로 위에 삽입
      if (targetArea && targetArea.parentNode) {
        targetArea.parentNode.insertBefore(foldersContainer, targetArea);
      } else if (sidebar && sidebar.firstChild) {
        sidebar.insertBefore(foldersContainer, sidebar.firstChild);
      } else if (sidebar) {
        sidebar.appendChild(foldersContainer);
      }

      // 전체 펼치기/접기 토글 상태 변수
      let isAllExpanded = true;

      // 중복 바인딩 방지 플래그(dataset.bound) 가드
      const toggleBtn = foldersContainer.querySelector(".btn-toggle-all");
      if (toggleBtn && !toggleBtn.dataset.bound) {
        toggleBtn.dataset.bound = "true";
        toggleBtn.addEventListener("click", () => {
          isAllExpanded = !isAllExpanded;
          folders.forEach(f => {
            expandedFolders[f.id] = isAllExpanded;
          });
          safeStorageLocalSet({ expandedFolders });
          renderSidebarFolderTree();
        });
      }

      const addRootBtn = foldersContainer.querySelector(".btn-add-root");
      if (addRootBtn && !addRootBtn.dataset.bound) {
        addRootBtn.dataset.bound = "true";
        addRootBtn.addEventListener("click", () => {
          openFolderModal();
        });
      }

      // 모달 버튼 핸들러 중복 등록 방지
      const modalCancelBtn = document.getElementById("gemini-modal-cancel");
      if (modalCancelBtn && !modalCancelBtn.dataset.bound) {
        modalCancelBtn.dataset.bound = "true";
        modalCancelBtn.addEventListener("click", () => {
          closeFolderModal();
        });
      }

      const modalSaveBtn = document.getElementById("gemini-modal-save");
      if (modalSaveBtn && !modalSaveBtn.dataset.bound) {
        modalSaveBtn.dataset.bound = "true";
        modalSaveBtn.addEventListener("click", () => {
          saveFolderFromModal();
        });
      }

      // 대화방 드래그 가능 바인딩
      makeChatItemsDraggable();
      setInterval(makeChatItemsDraggable, 2000);

      // 폴더 스토리지 데이터 로드 및 렌더링
      loadFoldersFromStorage();

      // 스토리지 변경 실시간 감지
      try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
          chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === "sync" && changes.folders) {
              folders = changes.folders.newValue || [];
              renderSidebarFolderTree();
            }
          });
        }
      } catch (e) {}

      // 활성화된 대화 하이라이트 동기화
      setInterval(updateActiveChatHighlight, 2000);

      // 📌 폴더 내 대화방 제목 1초 실시간 직접 동기화 Poller
      setInterval(updateFolderChatTitles, 1000);

      // 사이드바 DOM 텍스트 변경(이름 변경 등) 감지 및 폴더 하위 제목 자동 실시간 동기화
      const sidebarNav = document.querySelector(selectors.sidebarContainer || "nav");
      if (sidebarNav && !sidebarNav.dataset.titleObserved) {
        sidebarNav.dataset.titleObserved = "true";
        const titleMutationObserver = new MutationObserver(() => {
          renderSidebarFolderTree();
          updateFolderChatTitles();
        });
        titleMutationObserver.observe(sidebarNav, { childList: true, subtree: true, characterData: true });
      }
    }
  }, 1000);
}

// 📌 폴더 내 대화방 제목 실시간 직접 동기화 함수
function updateFolderChatTitles() {
  const clonedItems = document.querySelectorAll(".cloned-chat-item");
  if (clonedItems.length === 0) return;

  const sidebarLinks = Array.from(document.querySelectorAll("nav a[href*='/app/'], nav a[href*='/c/'], a[href*='/app/'], a[href*='/c/']"));

  clonedItems.forEach(item => {
    const chatId = item.dataset.chatId;
    if (!chatId) return;

    // 사이드바 A 태그에서 최신 원본 텍스트 찾기
    const targetLink = sidebarLinks.find(link => {
      const linkChatId = extractChatIdFromHref(link.getAttribute("href") || link.href);
      return linkChatId === chatId || (link.href && link.href.includes(chatId));
    });

    if (targetLink) {
      const titleEl = targetLink.querySelector(".conversation-title, .title-text, div[title], span[title]") || targetLink;
      let text = titleEl.innerText || titleEl.textContent || "";
      text = text.replace(/\n/g, " ").trim();

      if (text.length > 0) {
        const cleanTitle = text.split("  ")[0].trim();
        const titleSpan = item.querySelector(".cloned-chat-title");
        if (titleSpan && titleSpan.innerText !== cleanTitle) {
          titleSpan.innerText = cleanTitle;
          titleSpan.title = cleanTitle;
        }
      }
    }
  });
}

const FOLDER_SVG_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"></path></svg>`;
const MENU_SVG_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"></path></svg>`;

const DEFAULT_FOLDERS = [
  {
    id: "f_1784696460719",
    name: "업무",
    color: "#3B82F6",
    parentId: null,
    children: ["f_1784696534413", "f_1784696541683", "f_1784706818528"],
    chatIds: []
  },
  {
    id: "f_1784696534413",
    name: "GSITM",
    color: "#6EE7B7",
    parentId: "f_1784696460719",
    children: [],
    chatIds: []
  },
  {
    id: "f_1784696541683",
    name: "우에무라",
    color: "#93C5FD",
    parentId: "f_1784696460719",
    children: ["f_1785118678733"],
    chatIds: []
  },
  {
    id: "f_1785118678733",
    name: "사업계획",
    color: "#FBBF24",
    parentId: "f_1784696541683",
    children: [],
    chatIds: []
  },
  {
    id: "f_1784706818528",
    name: "AI",
    color: "#C084FC",
    parentId: "f_1784696460719",
    children: [],
    chatIds: []
  }
];

let customChatTitles = {}; // { [chatId]: "커스텀 제목" }
let pinnedChatIds = {};    // { [folderId]: ["chatId1"] }

// 스토리지로부터 폴더 및 대화 메타데이터 읽기
function loadFoldersFromStorage() {
  safeStorageSyncGet(["folders", "customChatTitles", "pinnedChatIds"], (result) => {
    if (!result.folders || result.folders.length === 0) {
      folders = DEFAULT_FOLDERS;
      safeStorageSyncSet({ folders: DEFAULT_FOLDERS });
    } else {
      folders = result.folders;
    }
    customChatTitles = result.customChatTitles || {};
    pinnedChatIds = result.pinnedChatIds || {};
    renderSidebarFolderTree();
  });
}

// 스토리지 동기화 저장
function saveFoldersToSync() {
  safeStorageSyncSet({ 
    folders: folders,
    customChatTitles: customChatTitles,
    pinnedChatIds: pinnedChatIds
  }, () => {
    renderSidebarFolderTree();
  });
}

// 대화 제목 조회 (Gemini 사이드바 텍스트 최우선 실시간 동기화)
function getChatTitleCached(chatId) {
  // 1. Gemini 사이드바 A 태그에서 최신 원본 대화명 탐색
  const links = Array.from(document.querySelectorAll("a[href*='/app/'], a[href*='/c/'], nav a"));
  for (let link of links) {
    if (link.href && link.href.includes(chatId)) {
      // 대화방 제목 엘리먼트 텍스트
      const titleEl = link.querySelector(".conversation-title, .title-text, div[title], span[title]") || link;
      let text = titleEl.innerText || titleEl.textContent || "";
      text = text.replace(/\n/g, " ").trim();
      
      // 불필요한 더보기 버튼 텍스트나 아이콘 제거
      if (text.length > 0) {
        return text.split("  ")[0].trim();
      }
    }
  }

  // 2. 사이드바 DOM에서 아직 렌더링 전일 경우 저장된 커스텀 이름
  if (customChatTitles[chatId]) {
    return customChatTitles[chatId];
  }
  
  return "대화방";
}

// 사이드바 폴더 트리 렌더링
function renderSidebarFolderTree() {
  const treeRoot = document.getElementById("gemini-sidebar-folder-tree-root");
  if (!treeRoot) return;

  treeRoot.innerHTML = "";

  if (folders.length === 0) {
    treeRoot.innerHTML = `
      <div class="empty-state">
        생성된 폴더가 없습니다.<br>➕ 버튼을 눌러 새 폴더를 생성하세요.
      </div>`;
    return;
  }

  // 최상위 폴더 렌더링
  const rootFolders = folders.filter(f => !f.parentId || !folders.some(p => p.id === f.parentId));
  
  rootFolders.forEach(folder => {
    const folderNode = buildFolderDOM(folder, 0);
    treeRoot.appendChild(folderNode);
  });

  // 드래그 앤 드롭 타겟 바인딩
  bindFolderDragEvents();
}

// 특정 폴더의 DOM 생성 (재귀)
function buildFolderDOM(folder, depth = 0) {
  const isExpanded = expandedFolders[folder.id] !== false; // 기본 열림 상태
  const childFolders = folders.filter(f => f.parentId === folder.id);
  const subFolderCount = childFolders.length;
  const chatCount = folder.chatIds ? folder.chatIds.length : 0;
  
  let badgeText = `${chatCount}`;
  if (subFolderCount > 0) {
    if (chatCount > 0) {
      badgeText = `${subFolderCount}+${chatCount}`;
    } else {
      badgeText = `${subFolderCount}`;
    }
  }

  const folderItem = document.createElement("div");
  folderItem.className = `folder-item ${isExpanded ? 'open' : ''}`;
  folderItem.dataset.folderId = folder.id;
  folderItem.dataset.folderDepth = depth;

  const paddingLeft = 12 + depth * 16;
  const folderColor = folder.color || "rgb(66, 133, 244)";

  folderItem.innerHTML = `
    <div class="folder-header" draggable="true" style="padding-left: ${paddingLeft}px;" data-folder-id="${folder.id}">
      <span class="arrow-icon">${(subFolderCount > 0 || chatCount > 0) ? (isExpanded ? '▼' : '▶') : '<span style="opacity:0">▶</span>'}</span>
      <span class="folder-icon" style="color: ${folderColor};">${FOLDER_SVG_ICON}</span>
      <span class="folder-name" style="flex-grow: 1; margin-left: 8px;">${folder.name}</span>
      <span class="count-badge" style="font-size: 10px; opacity: 0.5; margin-right: 8px;">${badgeText}</span>
      <span class="folder-menu-btn" title="폴더 메뉴">${MENU_SVG_ICON}</span>
    </div>
    <div class="folder-content" style="display: ${isExpanded ? 'block' : 'none'};"></div>
  `;

  const headerRow = folderItem.querySelector(".folder-header");
  const folderContent = folderItem.querySelector(".folder-content");
  const arrowIcon = folderItem.querySelector(".arrow-icon");

  // 폴더 열기/접기 토글
  headerRow.addEventListener("click", (e) => {
    if (e.target.closest(".folder-menu-btn")) return;

    if (subFolderCount > 0 || chatCount > 0) {
      const isOpen = folderItem.classList.contains("open");
      if (isOpen) {
        folderItem.classList.remove("open");
        folderContent.style.display = "none";
        arrowIcon.innerText = "▶";
        expandedFolders[folder.id] = false;
      } else {
        folderItem.classList.add("open");
        folderContent.style.display = "block";
        arrowIcon.innerText = "▼";
        expandedFolders[folder.id] = true;
      }
      safeStorageLocalSet({ expandedFolders });
    }
  });

  // 폴더 메뉴 버튼
  folderItem.querySelector(".folder-menu-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    openContextMenu(e, folder);
  });

  // 자식 폴더 붙이기
  childFolders.forEach(sub => {
    const subNode = buildFolderDOM(sub, depth + 1);
    folderContent.appendChild(subNode);
  });

  // 대화 목록 붙이기 (cloned-chat-item)
  if (folder.chatIds && folder.chatIds.length > 0) {
    const chatMarginLeft = paddingLeft + 29;

    folder.chatIds.forEach(chatId => {
      const chatItem = document.createElement("div");
      chatItem.className = "cloned-chat-item";
      chatItem.dataset.cloneId = `chat_${chatId}`;
      chatItem.dataset.chatId = chatId;
      chatItem.setAttribute("draggable", "true");
      chatItem.style.marginLeft = `${chatMarginLeft}px`;

      const chatTitle = getChatTitleCached(chatId);

      chatItem.innerHTML = `
        <span class="cloned-chat-title" title="${chatTitle}">${chatTitle}</span>
        <span class="gemini-native-menu-btn" title="Gemini 대화 메뉴 (고정/이름변경/삭제)">${MENU_SVG_ICON}</span>
        <span class="remove-chat-btn" title="폴더에서 제외">×</span>
      `;

      chatItem.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", chatId);
        e.dataTransfer.effectAllowed = "move";
        setCleanSingleLineDragGhost(e, chatTitle);
      });

      chatItem.addEventListener("dragend", () => {
        if (currentDragGhostEl) {
          try { currentDragGhostEl.remove(); } catch(err) {}
        }
      });

      chatItem.addEventListener("click", (e) => {
        if (e.target.closest(".gemini-native-menu-btn") || e.target.closest(".remove-chat-btn")) return;
        navigateToChat(chatId);
      });

      // Gemini 원본 사이드바 더보기 메뉴 (고정, 이름변경, 삭제 등) 연동 클릭
      chatItem.querySelector(".gemini-native-menu-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        triggerGeminiNativeChatMenu(e, folder.id, chatId, chatTitle);
      });

      chatItem.querySelector(".remove-chat-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        unmapChatFromFolder(folder.id, chatId);
      });

      folderContent.appendChild(chatItem);
    });
  }

  return folderItem;
}

// 로컬/DOM 캐시에서 대화방 제목 획득
function getChatTitleCached(chatId) {
  // 원래 사이드바에서 해당 chatId를 가지는 링크 엘리먼트를 찾음
  const sidebarLinks = Array.from(document.querySelectorAll(selectors.chatItemAnchor));
  for (let link of sidebarLinks) {
    if (link.href.includes(chatId)) {
      // 제미나이 사이드바 대화 텍스트 반환
      return link.innerText.trim() || "대화방";
    }
  }
  return "대화방";
}

// 대화방으로 이동 (내비게이션)
function navigateToChat(chatId) {
  const sidebarLinks = Array.from(document.querySelectorAll(selectors.chatItemAnchor));
  let clicked = false;
  
  for (let link of sidebarLinks) {
    if (link.href.includes(chatId)) {
      link.click();
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    // 링크를 다이렉트로 클릭 못했을 경우 URL 강제 전환
    window.location.href = `/app/${chatId}`;
  }
}

// 활성 대화방 하이라이트 동기화
function updateActiveChatHighlight() {
  const path = window.location.pathname;
  let activeChatId = "";
  
  // URL에서 대화방 ID 추출
  const match = path.match(/\/app\/([a-zA-Z0-9_-]+)/) || path.match(/\/c\/([a-zA-Z0-9_-]+)/);
  if (match) {
    activeChatId = match[1];
  }

  document.querySelectorAll(".cloned-chat-item").forEach(item => {
    if (item.dataset.chatId === activeChatId) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });
}

// 대화방을 폴더에서 제거
function unmapChatFromFolder(folderId, chatId) {
  folders = folders.map(f => {
    if (f.id === folderId) {
      f.chatIds = (f.chatIds || []).filter(id => id !== chatId);
    }
    return f;
  });
  saveFoldersToSync();
}

// URL에서 고유 대화 ID 정밀 추출
function extractChatIdFromHref(href) {
  if (!href) return "";
  const match = href.match(/\/app\/([a-zA-Z0-9_-]+)/) || href.match(/\/c\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : "";
}

/* ==========================================
   Gemini 원본 대화방 메뉴(고정, 이름변경, 대화공유, 삭제 등) 정밀 연동 트리거
   ========================================== */
function triggerGeminiNativeChatMenu(e, folderId, chatId, currentTitle) {
  const clickTarget = e.target.closest(".gemini-native-menu-btn") || e.target;
  const targetRect = clickTarget.getBoundingClientRect();

  // 고유 chatId를 가진 정확한 사이드바 A 태그 1개만 탐색
  const sidebarLinks = Array.from(document.querySelectorAll("nav a[href*='/app/'], nav a[href*='/c/'], a[href*='/app/'], a[href*='/c/']"));
  const targetLink = sidebarLinks.find(link => {
    const linkChatId = extractChatIdFromHref(link.getAttribute("href") || link.href);
    return linkChatId === chatId || (link.href && link.href.includes(chatId));
  });

  if (targetLink) {
    // 넓은 div가 아닌 타겟 항목만을 직접 감싸는 좁은 범위 부모 탐색
    let parentRow = targetLink.closest("g-sidenav-item, nav li, div.recent-item, .conversation-item") || targetLink.parentElement;

    targetLink.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    if (parentRow) parentRow.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    setTimeout(() => {
      // 좁은 범위 parentRow 내부에서만 대상 더보기 버튼 탐색 (다른 대화방 버튼 혼동 완전 차단)
      let nativeBtn = null;
      if (parentRow) {
        nativeBtn = parentRow.querySelector("button[aria-label*='메뉴'], button[aria-label*='Menu'], button[aria-haspopup='true']");
        if (!nativeBtn) {
          const btns = Array.from(parentRow.querySelectorAll("button"));
          nativeBtn = btns.find(b => b.offsetWidth > 0 && b.offsetHeight > 0) || btns[0];
        }
      }

      if (nativeBtn) {
        nativeBtn.click();

        // 📌 생성된 Gemini 원본 CDK 팝업 메뉴 위치를 클릭한 폴더 대화 항목 위치로 즉시 재배치
        const repositionOverlay = () => {
          const overlays = document.querySelectorAll(".cdk-overlay-pane, div[role='menu'], .mat-mdc-menu-panel");
          overlays.forEach(overlay => {
            if (overlay && overlay.offsetHeight > 0) {
              overlay.style.position = "fixed";
              overlay.style.top = `${targetRect.bottom + 4}px`;
              overlay.style.left = `${Math.min(targetRect.left, window.innerWidth - 220)}px`;
              overlay.style.zIndex = "10005";
              overlay.style.transform = "none";
            }
          });
        };

        setTimeout(repositionOverlay, 10);
        setTimeout(repositionOverlay, 50);
        setTimeout(repositionOverlay, 120);
        return;
      }
      openFallbackChatContextMenu(e, folderId, chatId, currentTitle);
    }, 80);
  } else {
    openFallbackChatContextMenu(e, folderId, chatId, currentTitle);
  }
}

function openFallbackChatContextMenu(e, folderId, chatId, currentTitle) {
  closeContextMenu();

  const menu = document.createElement("div");
  menu.id = "gemini-folder-context-menu";
  menu.className = "gemini-context-menu-overlay";

  menu.innerHTML = `
    <div class="menu-action-item btn-chat-rename">✎ 대화 이름 변경 (Rename)</div>
    <div class="menu-divider"></div>
    <div class="menu-action-item btn-chat-delete" style="color: #ef4444; font-weight: 500;">✖ 폴더에서 제외 (Remove)</div>
  `;

  document.body.appendChild(menu);

  const rect = e.target.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY + 6}px`;
  menu.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 200)}px`;

  menu.querySelector(".btn-chat-rename").addEventListener("click", (evt) => {
    evt.stopPropagation();
    closeContextMenu();
    const newTitle = prompt("대화의 새 이름을 입력하세요:", currentTitle);
    if (newTitle !== null && newTitle.trim() !== "") {
      customChatTitles[chatId] = newTitle.trim();
      saveFoldersToSync();
    }
  });

  menu.querySelector(".btn-chat-delete").addEventListener("click", (evt) => {
    evt.stopPropagation();
    closeContextMenu();
    unmapChatFromFolder(folderId, chatId);
  });

  setTimeout(() => {
    document.addEventListener("click", closeContextMenuOnOuterClick);
  }, 10);
}

let currentDragGhostEl = null;

// 깔끔한 단일 줄 커스텀 드래그 칩 고스트 지정 (여러 줄 겹침 방지)
function setCleanSingleLineDragGhost(e, titleText) {
  if (currentDragGhostEl) {
    try { currentDragGhostEl.remove(); } catch(err) {}
  }

  const ghost = document.createElement("div");
  ghost.id = "gemini-clean-drag-ghost";
  ghost.style.position = "fixed";
  ghost.style.top = "-9999px";
  ghost.style.left = "-9999px";
  ghost.style.padding = "6px 14px";
  ghost.style.background = "#1a73e8";
  ghost.style.color = "#ffffff";
  ghost.style.fontSize = "12.5px";
  ghost.style.fontWeight = "600";
  ghost.style.borderRadius = "18px";
  ghost.style.boxShadow = "0 4px 14px rgba(0,0,0,0.25)";
  ghost.style.pointerEvents = "none";
  ghost.style.whiteSpace = "nowrap";
  ghost.style.zIndex = "99999";
  
  const displayTitle = titleText.length > 22 ? titleText.substring(0, 22) + "..." : titleText;
  ghost.innerText = `💬 ${displayTitle}`;

  document.body.appendChild(ghost);
  currentDragGhostEl = ghost;

  if (e.dataTransfer && e.dataTransfer.setDragImage) {
    e.dataTransfer.setDragImage(ghost, 15, 15);
  }

  setTimeout(() => {
    if (ghost) {
      try { ghost.remove(); } catch(err) {}
    }
  }, 100);
}

// 대화 리스트 아이템에 dragstart 이벤트 및 draggable 설정
function makeChatItemsDraggable() {
  const chatAnchors = document.querySelectorAll(selectors.chatItemAnchor || "a[href*='/app/']");
  chatAnchors.forEach(anchor => {
    if (anchor.getAttribute("draggable") === "true") return;

    anchor.setAttribute("draggable", "true");
    
    // 드래그 시작 이벤트
    anchor.addEventListener("dragstart", (e) => {
      const href = anchor.getAttribute("href") || "";
      const chatId = extractChatIdFromHref(href);

      if (chatId) {
        e.dataTransfer.setData("text/plain", chatId);
        e.dataTransfer.effectAllowed = "move";
        
        const titleText = anchor.innerText ? anchor.innerText.split("\n")[0].trim() : "대화방";
        setCleanSingleLineDragGhost(e, titleText);

        setTimeout(() => {
          anchor.classList.add("gemini-dragging-item");
        }, 0);
      }
    });

    anchor.addEventListener("dragend", () => {
      anchor.classList.remove("gemini-dragging-item");
      if (currentDragGhostEl) {
        try { currentDragGhostEl.remove(); } catch(err) {}
      }
    });
  });
}

// 폴더 드래그 앤 드롭 바인딩
function bindFolderDragEvents() {
  const folderRows = document.querySelectorAll(".folder-header");
  
  folderRows.forEach(row => {
    const targetFolderId = row.dataset.folderId;
    
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      row.classList.add("gemini-drag-over");
    });

    row.addEventListener("dragleave", () => {
      row.classList.remove("gemini-drag-over");
    });

    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("gemini-drag-over");
      
      const chatId = e.dataTransfer.getData("text/plain");
      if (!chatId) return;

      // 1. 타 폴더에 이미 매핑되어 있는지 확인하고 제거
      folders = folders.map(f => {
        if (f.chatIds) {
          f.chatIds = f.chatIds.filter(id => id !== chatId);
        }
        return f;
      });

      // 2. 대상 폴더에 추가
      folders = folders.map(f => {
        if (f.id === targetFolderId) {
          if (!f.chatIds) f.chatIds = [];
          if (!f.chatIds.includes(chatId)) {
            f.chatIds.push(chatId);
          }
        }
        return f;
      });

      // 스토리지 저장 및 갱신
      saveFoldersToSync();
    });
  });
}

/* ==========================================
   컨텍스트 메뉴 (Context Menu Overlay - Clean 12 Color Spec)
   ========================================== */
function openContextMenu(e, folder) {
  closeContextMenu();

  const menu = document.createElement("div");
  menu.id = "gemini-folder-context-menu";
  menu.className = "gemini-context-menu-overlay";
  
  // 스크린샷과 동일한 깔끔한 12가지 색상 팔레트
  const colors = [
    "#F87171", "#FBBF24", "#FACC15", "#34D399", 
    "#6EE7B7", "#3B82F6", "#93C5FD", "#C084FC", 
    "#A855F7", "#F472B6", "#E6C8A4", "#CBD5E1"
  ];
  
  let colorChipsHTML = '<div class="color-chips-grid">';
  colors.forEach(c => {
    const isActive = (folder.color === c) ? 'active' : '';
    colorChipsHTML += `<div class="color-chip-item ${isActive}" data-color="${c}" style="background-color: ${c};"></div>`;
  });
  colorChipsHTML += '</div>';

  menu.innerHTML = `
    ${colorChipsHTML}
    <div class="menu-divider"></div>
    <div class="menu-action-item btn-menu-add-sub">Add Subfolder</div>
    <div class="menu-action-item btn-menu-rename">Rename</div>
    <div class="menu-action-item btn-menu-delete" style="color: #ef4444; font-weight: 500;">Delete Folder</div>
  `;

  document.body.appendChild(menu);

  const rect = e.target.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY + 6}px`;
  menu.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 200)}px`;

  // 12가지 색상 칩 클릭
  menu.querySelectorAll(".color-chip-item").forEach(chip => {
    chip.addEventListener("click", (evt) => {
      evt.stopPropagation();
      const selectedColor = chip.dataset.color;
      folders = folders.map(f => {
        if (f.id === folder.id) f.color = selectedColor;
        return f;
      });
      saveFoldersToSync();
      closeContextMenu();
    });
  });

  // Add Subfolder
  menu.querySelector(".btn-menu-add-sub").addEventListener("click", (evt) => {
    evt.stopPropagation();
    closeContextMenu();
    openFolderModal(null, folder.id);
  });

  // Rename
  menu.querySelector(".btn-menu-rename").addEventListener("click", (evt) => {
    evt.stopPropagation();
    closeContextMenu();
    openFolderModal(folder.id);
  });

  // Delete Folder
  menu.querySelector(".btn-menu-delete").addEventListener("click", (evt) => {
    evt.stopPropagation();
    closeContextMenu();
    if (confirm(`'${folder.name}' 폴더를 삭제하시겠습니까? 하위 폴더도 함께 삭제됩니다.`)) {
      deleteFolderCascade(folder.id);
    }
  });

  setTimeout(() => {
    document.addEventListener("click", closeContextMenuOnOuterClick);
  }, 10);
}



function closeContextMenuOnOuterClick(e) {
  const menu = document.getElementById("gemini-folder-context-menu");
  if (menu && !menu.contains(e.target) && !e.target.closest(".folder-menu-btn")) {
    closeContextMenu();
  }
}

function closeContextMenu() {
  const menu = document.getElementById("gemini-folder-context-menu");
  if (menu) menu.remove();
  document.removeEventListener("click", closeContextMenuOnOuterClick);
}

// 폴더 모달 열기
function openFolderModal(editId = null, parentId = null) {
  const modal = document.getElementById("gemini-folder-modal");
  const input = document.getElementById("gemini-modal-folder-name");
  const editIdField = document.getElementById("gemini-modal-edit-id");
  const parentIdField = document.getElementById("gemini-modal-parent-id");

  if (!modal || !input) return;

  editIdField.value = editId || "";
  parentIdField.value = parentId || "";

  if (editId) {
    const f = folders.find(folder => folder.id === editId);
    input.value = f ? f.name : "";
  } else {
    input.value = "";
  }

  modal.classList.remove("hidden");
  modal.style.display = "flex";

  // 모달 오버레이 배경 클릭 시 닫기
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeFolderModal();
    }
  };

  // 키보드 엔터/ESC 처리
  const handleModalKeyDown = (e) => {
    if (e.key === "Escape") {
      closeFolderModal();
      document.removeEventListener("keydown", handleModalKeyDown);
    } else if (e.key === "Enter") {
      e.preventDefault();
      saveFolderFromModal();
      document.removeEventListener("keydown", handleModalKeyDown);
    }
  };
  document.addEventListener("keydown", handleModalKeyDown);

  setTimeout(() => {
    input.focus();
    input.select();
  }, 50);
}

function closeFolderModal() {
  const modal = document.getElementById("gemini-folder-modal");
  if (modal) {
    modal.classList.add("hidden");
    modal.style.display = "none";
  }
}

let lastFolderSaveTimestamp = 0;

// 모달 저장 버튼 핸들러
function saveFolderFromModal() {
  const now = Date.now();
  if (now - lastFolderSaveTimestamp < 500) {
    return; // 500ms 이내 중복 연타/중복 실행 완전 차단
  }
  lastFolderSaveTimestamp = now;

  const nameInput = document.getElementById("gemini-modal-folder-name");
  if (!nameInput) return;

  const name = nameInput.value.trim();
  if (!name) {
    closeFolderModal();
    return;
  }

  const editId = document.getElementById("gemini-modal-edit-id").value;
  const parentId = document.getElementById("gemini-modal-parent-id").value || null;

  if (editId) {
    // 이름 수정
    folders = folders.map(f => {
      if (f.id === editId) f.name = name;
      return f;
    });
  } else {
    // 신규 생성
    const newId = "folder_" + Date.now();
    const newFolder = {
      id: newId,
      name: name,
      color: "#4A90E2", // 기본 파란색
      parentId: parentId,
      children: [],
      chatIds: []
    };
    folders.push(newFolder);

    // 부모 폴더의 children 관계 주입
    if (parentId) {
      folders = folders.map(f => {
        if (f.id === parentId) {
          if (!f.children) f.children = [];
          f.children.push(newId);
        }
        return f;
      });
      // 부모 펼치기 상태 강제
      expandedFolders[parentId] = true;
      chrome.storage.local.set({ expandedFolders });
    }
  }

  saveFoldersToSync();
  closeFolderModal();
}

// 연쇄 삭제
function deleteFolderCascade(folderId) {
  let idsToDelete = [folderId];
  
  function collectChildren(id) {
    folders.forEach(f => {
      if (f.parentId === id) {
        idsToDelete.push(f.id);
        collectChildren(f.id);
      }
    });
  }
  
  collectChildren(folderId);

  folders = folders.filter(f => !idsToDelete.includes(f.id));

  // 부모의 children 관계 갱신
  folders = folders.map(f => {
    if (f.children) {
      f.children = f.children.filter(cid => !idsToDelete.includes(cid));
    }
    return f;
  });

  saveFoldersToSync();
}

// 동기화 스토리지로 저장 및 새로 렌더링
function saveFoldersToSync() {
  chrome.storage.sync.set({ folders: folders }, () => {
    renderSidebarFolderTree();
  });
}

/* ==========================================
   D. 대화 내보내기(Export) 버튼 및 MutationObserver (성능 최적화)
   ========================================== */
let exportInjectTimeout = null;

function setupMutationObserver() {
  if (mutationObserver) mutationObserver.disconnect();

  mutationObserver = new MutationObserver(() => {
    // 스크롤 및 DOM 변형 폭주 방지를 위한 250ms 디바운스
    if (exportInjectTimeout) clearTimeout(exportInjectTimeout);
    exportInjectTimeout = setTimeout(() => {
      injectExportButtons(document.body);
    }, 250);
  });

  const targetContainer = document.querySelector("main") || document.body;
  mutationObserver.observe(targetContainer, { childList: true, subtree: true });
  injectExportButtons(document.body);
}

function isGeminiLightTheme() {
  try {
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    if (bodyBg && bodyBg.includes("rgb")) {
      const match = bodyBg.match(/\d+/g);
      if (match && match.length >= 3) {
        const r = parseInt(match[0], 10);
        const g = parseInt(match[1], 10);
        const b = parseInt(match[2], 10);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        if (brightness > 130) return true;
      }
    }
  } catch (e) {}

  return document.body.classList.contains("light-theme") || 
         document.documentElement.getAttribute("data-theme") === "light" ||
         document.body.getAttribute("data-theme") === "light" ||
         window.matchMedia("(prefers-color-scheme: light)").matches;
}

function injectExportButtons(container) {
  // 답변을 나타내는 최상위 래퍼 노드들만 선택 (자식 노드 다중 선택 방지)
  const targetBlocks = container.querySelectorAll(".model-response-container, message-content, div.model-response-container, .response-container");
  const isLight = isGeminiLightTheme();

  targetBlocks.forEach(block => {
    // 1) 이미 해당 블록이나 자식에 버튼이 존재하거나 data-gemini-export-injected 마킹이 있으면 무조건 스킵
    if (block.getAttribute("data-gemini-export-injected") === "true" || block.querySelector(".gemini-export-btn-container")) {
      return;
    }

    // 2) 조상 요소에 이미 버튼이 포함된 답변 블록이 있으면 스킵
    const ancestor = block.parentElement ? block.parentElement.closest("[data-gemini-export-injected='true'], .model-response-container, message-content") : null;
    if (ancestor && ancestor.querySelector(".gemini-export-btn-container")) {
      return;
    }

    block.setAttribute("data-gemini-export-injected", "true");

    const btnContainer = document.createElement("div");
    btnContainer.className = "gemini-export-btn-container";
    if (isLight) {
      btnContainer.setAttribute("data-theme", "light");
    } else {
      btnContainer.setAttribute("data-theme", "dark");
    }

    btnContainer.innerHTML = `
      <span class="gemini-export-label">Export:</span>
      <!-- <button class="gemini-export-btn btn-img" title="대화 카드 이미지 저장">IMAGE</button> -->
      <button class="gemini-export-btn btn-md" title="답변 마크다운(.md) 저장">MD</button>
      <button class="gemini-export-btn btn-json" title="질문/답변 JSON 구조 저장">JSON</button>
    `;

    // 답변 본문 텍스트(.markdown) 직후 또는 유틸리티 바 전에 깔끔하게 1개만 주입
    const markdownContent = block.querySelector(".markdown, .model-response");
    if (markdownContent && markdownContent.parentNode === block) {
      block.insertBefore(btnContainer, markdownContent.nextSibling);
    } else {
      block.appendChild(btnContainer);
    }

    const btnMd = btnContainer.querySelector(".btn-md");
    const btnJson = btnContainer.querySelector(".btn-json");

    btnMd.addEventListener("click", (e) => {
      e.stopPropagation();
      exportToMD(block, btnMd);
    });

    btnJson.addEventListener("click", (e) => {
      e.stopPropagation();
      exportToJSON(block, btnJson);
    });
  });
}

function openImageExportModal(responseEl, btn) {
  const oldModal = document.getElementById("gemini-export-modal");
  if (oldModal) oldModal.remove();

  const isLight = isGeminiLightTheme();

  const modalBackdrop = document.createElement("div");
  modalBackdrop.id = "gemini-export-modal";
  modalBackdrop.className = "gemini-export-modal-backdrop";

  modalBackdrop.innerHTML = `
    <div class="gemini-export-modal-card ${isLight ? 'data-theme="light"' : ''}">
      <div class="gemini-modal-header">
        <h3>🖼️ 대화 이미지 저장 방식 선택</h3>
        <button class="gemini-modal-close-btn">&times;</button>
      </div>
      <div class="gemini-modal-body">
        <div class="gemini-option-card" data-mode="mobile">
          <div class="icon">📱</div>
          <div class="info">
            <div class="title">모바일용 카드 (450px)</div>
            <div class="desc">카카오톡, 인스타그램, 스마트폰 화면 공유에 최적화된 슬림 카드</div>
          </div>
        </div>
        <div class="gemini-option-card" data-mode="pc">
          <div class="icon">💻</div>
          <div class="info">
            <div class="title">PC/데스크탑용 카드 (800px)</div>
            <div class="desc">블로그, 노션 문서 작성 및 PC 화면에 최적화된 와이드 카드</div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modalBackdrop);

  const closeBtn = modalBackdrop.querySelector(".gemini-modal-close-btn");
  closeBtn.addEventListener("click", () => modalBackdrop.remove());

  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) modalBackdrop.remove();
  });

  const optionCards = modalBackdrop.querySelectorAll(".gemini-option-card");
  optionCards.forEach((card) => {
    card.addEventListener("click", () => {
      const mode = card.getAttribute("data-mode");
      const targetWidth = mode === "mobile" ? 450 : 800;
      modalBackdrop.remove();
      exportToPNGByWidth(responseEl, btn, targetWidth);
    });
  });
}

function exportToPNGByWidth(responseEl, btn, targetWidth = 720) {
  const originalHTML = btn ? btn.innerHTML : "IMAGE";
  setBtnLoading(btn, true, originalHTML);

  setTimeout(async () => {
    try {
      // 1) 질문(User Prompt) 텍스트 추출
      let parent = responseEl.parentElement;
      let questionText = "";
      while (parent && parent !== document.body) {
        const qNode = parent.querySelector(selectors.userPromptText);
        if (qNode) {
          questionText = (qNode.innerText || qNode.textContent || "").trim();
          break;
        }
        parent = parent.parentElement;
      }

      // 2) 답변(AI Response) 본문을 TurndownService로 순수 마크다운 변환!
      const responseClone = responseEl.cloneNode(true);
      const btnContainer = responseClone.querySelector(".gemini-export-btn-container");
      if (btnContainer) btnContainer.remove();

      const isLight = isGeminiLightTheme();
      let formattedBodyHTML = responseClone.innerHTML;

      if (typeof TurndownService !== "undefined") {
        const turndownService = new TurndownService({
          headingStyle: "atx",
          codeBlockStyle: "fenced"
        });
        const pureMarkdown = turndownService.turndown(responseClone.innerHTML);
        formattedBodyHTML = renderMarkdownToPrettyHTML(pureMarkdown, isLight);
      }

      const nowStr = new Date().toLocaleString("ko-KR");
      const modeLabel = targetWidth <= 500 ? "Mobile Card" : "PC Wide Card";

      // 3) 오프스크린 마크다운 카드 DOM 명시적 생성
      const offscreenCard = document.createElement("div");
      offscreenCard.id = "gemini-offscreen-export-card";
      offscreenCard.style.cssText = `
        position: fixed;
        left: -9999px;
        top: 0;
        width: ${targetWidth}px;
        padding: 22px;
        border-radius: 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-sizing: border-box;
        z-index: -9999;
        ${isLight ? 
          "background: #ffffff; color: #0f172a; border: 1.5px solid #cbd5e1; box-shadow: 0 10px 30px rgba(0,0,0,0.08);" : 
          "background: #111422; color: #f8fafc; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 10px 30px rgba(0,0,0,0.5);"
        }
      `;

      offscreenCard.innerHTML = `
        <!-- Card Header -->
        <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 12px; margin-bottom: 14px; border-bottom: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.12)'};">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 10px; height: 10px; border-radius: 50%; background: #6366f1;"></div>
            <span style="font-weight: 800; font-size: 12.5px; color: ${isLight ? '#6366f1' : '#a5b4fc'}; letter-spacing: 0.5px;">Gemini Helper (${modeLabel})</span>
          </div>
          <span style="font-size: 11px; color: ${isLight ? '#64748b' : '#94a3b8'};">${nowStr}</span>
        </div>

        <!-- User Question Box -->
        ${questionText ? `
        <div style="background: ${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.05)'}; border: 1px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.1)'}; border-radius: 10px; padding: 12px 14px; margin-bottom: 14px;">
          <div style="font-size: 11px; font-weight: 700; color: ${isLight ? '#475569' : '#94a3b8'}; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">👤 User</div>
          <div style="font-size: 13px; font-weight: 600; line-height: 1.5; color: ${isLight ? '#0f172a' : '#f8fafc'}; white-space: pre-wrap; word-break: break-word;">${escapeHTML(questionText)}</div>
        </div>
        ` : ''}

        <!-- Gemini Answer Markdown Card Box -->
        <div style="background: ${isLight ? '#ffffff' : 'transparent'}; border-radius: 10px;">
          <div style="font-size: 11px; font-weight: 700; color: ${isLight ? '#6366f1' : '#a5b4fc'}; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">✨ Gemini</div>
          <div class="gemini-offscreen-body" style="font-size: 13px; line-height: 1.6; word-break: break-word;">
            ${formattedBodyHTML}
          </div>
        </div>
      `;

      document.body.appendChild(offscreenCard);

      // 4) Voyager급 SVG foreignObject 초고속 GPU 렌더링 시도 및 html2canvas fallback
      const svgData = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${targetWidth}" height="${offscreenCard.offsetHeight || 600}">
          <foreignObject width="100%" height="100%">
            ${offscreenCard.outerHTML}
          </foreignObject>
        </svg>
      `;

      const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth * 1.5;
        canvas.height = (offscreenCard.offsetHeight || 600) * 1.5;
        const ctx = canvas.getContext("2d");
        ctx.scale(1.5, 1.5);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        offscreenCard.remove();

        canvas.toBlob((blob) => {
          downloadBlob(blob, `gemini_chat_${targetWidth}px_${Date.now()}.png`);
          try {
            const item = new ClipboardItem({ "image/png": blob });
            navigator.clipboard.write([item]);
          } catch (err) {}
          setBtnLoading(btn, false, originalHTML);
        }, "image/png");
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        if (typeof html2canvas !== "undefined") {
          html2canvas(offscreenCard, { scale: 1.5, useCORS: true }).then(canvas => {
            offscreenCard.remove();
            canvas.toBlob(blob => {
              downloadBlob(blob, `gemini_chat_${targetWidth}px_${Date.now()}.png`);
              try {
                const item = new ClipboardItem({ "image/png": blob });
                navigator.clipboard.write([item]);
              } catch (err) {}
              setBtnLoading(btn, false, originalHTML);
            }, "image/png");
          }).catch(() => {
            offscreenCard.remove();
            setBtnLoading(btn, false, originalHTML);
          });
        } else {
          offscreenCard.remove();
          setBtnLoading(btn, false, originalHTML);
        }
      };

      img.src = url;

    } catch (err) {
      alert("오프스크린 마크다운 이미지 처리 중 오류가 발생했습니다: " + err.message);
      setBtnLoading(btn, false, originalHTML);
    }
  }, 50);
}

function renderMarkdownToPrettyHTML(mdText, isLight) {
  if (!mdText) return "";
  let html = mdText
    .replace(/```([\s\S]*?)```/g, (match, p1) => {
      const codeLines = p1.trim();
      return `<pre style="background: ${isLight ? '#f1f5f9' : '#0f172a'}; color: ${isLight ? '#0f172a' : '#f8fafc'}; border: 1px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.15)'}; border-radius: 8px; padding: 12px; font-family: Consolas, Monaco, monospace; font-size: 12px; overflow-x: auto; margin: 10px 0;"><code>${escapeHTML(codeLines)}</code></pre>`;
    })
    .replace(/`([^`]+)`/g, `<code style="background: ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.1)'}; padding: 2px 5px; border-radius: 4px; font-family: monospace; font-size: 12px;">$1</code>`)
    .replace(/\*\*([^*]+)\*\*/g, `<strong>$1</strong>`)
    .replace(/\n/g, "<br>");
  return html;
}

function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function setBtnLoading(btn, isLoading, originalHTML) {
  if (!btn) return;
  const container = btn.closest(".gemini-export-btn-container");
  const allBtns = container ? container.querySelectorAll(".gemini-export-btn") : [btn];

  if (isLoading) {
    allBtns.forEach((b) => {
      b.disabled = true;
    });
    btn.innerHTML = `<span class="gemini-btn-spinner"></span> <span>생성 중...</span>`;
  } else {
    allBtns.forEach((b) => {
      b.disabled = false;
    });
    btn.innerHTML = originalHTML;
  }
}

function exportToMD(responseEl, btn) {
  const originalHTML = btn ? btn.innerHTML : "MD";
  setBtnLoading(btn, true, originalHTML);

  setTimeout(() => {
    try {
      const clone = responseEl.cloneNode(true);
      const btnContainer = clone.querySelector(".gemini-export-btn-container");
      if (btnContainer) btnContainer.remove();

      if (typeof TurndownService !== "undefined") {
        const turndownService = new TurndownService({
          headingStyle: "atx",
          codeBlockStyle: "fenced"
        });
        
        const markdown = turndownService.turndown(clone.innerHTML);
        const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
        downloadBlob(blob, `gemini_chat_${Date.now()}.md`);
      } else {
        alert("Markdown 변환 라이브러리를 로드하지 못했습니다.");
      }
    } catch (err) {
      alert("마크다운 변환 중 오류가 발생했습니다: " + err.message);
    } finally {
      setBtnLoading(btn, false, originalHTML);
    }
  }, 100);
}

function exportToPNG(responseEl, btn) {
  const originalHTML = btn ? btn.innerHTML : "PNG";
  setBtnLoading(btn, true, originalHTML);

  setTimeout(() => {
    try {
      if (typeof html2canvas === "undefined") {
        alert("html2canvas 라이브러리를 로드하지 못했습니다.");
        setBtnLoading(btn, false, originalHTML);
        return;
      }

      // 1) 질문(User Prompt) 텍스트 추출
      let parent = responseEl.parentElement;
      let questionText = "";
      while (parent && parent !== document.body) {
        const qNode = parent.querySelector(selectors.userPromptText);
        if (qNode) {
          questionText = (qNode.innerText || qNode.textContent || "").trim();
          break;
        }
        parent = parent.parentElement;
      }

      // 2) 답변(AI Response) 복제 및 내보내기 버튼 제거
      const responseClone = responseEl.cloneNode(true);
      const btnContainer = responseClone.querySelector(".gemini-export-btn-container");
      if (btnContainer) btnContainer.remove();

      const isLight = isGeminiLightTheme();

      // 3) 초고속 렌더링용 오프스크린 카드 DOM 생성 (700px 슬림 카드)
      const offscreenCard = document.createElement("div");
      offscreenCard.id = "gemini-offscreen-export-card";
      offscreenCard.style.cssText = `
        position: fixed;
        left: -9999px;
        top: 0;
        width: 720px;
        padding: 24px;
        border-radius: 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-sizing: border-box;
        z-index: -9999;
        ${isLight ? 
          "background: #ffffff; color: #0f172a; border: 1.5px solid #cbd5e1; box-shadow: 0 10px 30px rgba(0,0,0,0.08);" : 
          "background: #111422; color: #f8fafc; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 10px 30px rgba(0,0,0,0.5);"
        }
      `;

      const nowStr = new Date().toLocaleString("ko-KR");

      offscreenCard.innerHTML = `
        <!-- Card Header -->
        <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 12px; margin-bottom: 16px; border-bottom: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.12)'};">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 10px; height: 10px; border-radius: 50%; background: #6366f1;"></div>
            <span style="font-weight: 800; font-size: 13px; color: ${isLight ? '#6366f1' : '#a5b4fc'}; letter-spacing: 0.5px;">Gemini Helper Export</span>
          </div>
          <span style="font-size: 11px; color: ${isLight ? '#64748b' : '#94a3b8'};">${nowStr}</span>
        </div>

        <!-- User Question Box (질문이 있는 경우) -->
        ${questionText ? `
        <div style="background: ${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.05)'}; border: 1px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.1)'}; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px;">
          <div style="font-size: 11px; font-weight: 700; color: ${isLight ? '#475569' : '#94a3b8'}; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">👤 User</div>
          <div style="font-size: 13.5px; font-weight: 600; line-height: 1.5; color: ${isLight ? '#0f172a' : '#f8fafc'}; white-space: pre-wrap; word-break: break-word;">${questionText}</div>
        </div>
        ` : ''}

        <!-- Gemini Answer Box -->
        <div style="background: ${isLight ? '#ffffff' : 'transparent'}; border-radius: 10px;">
          <div style="font-size: 11px; font-weight: 700; color: ${isLight ? '#6366f1' : '#a5b4fc'}; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">✨ Gemini</div>
          <div class="gemini-offscreen-body" style="font-size: 13.5px; line-height: 1.6; word-break: break-word;">
            ${responseClone.innerHTML}
          </div>
        </div>
      `;

      document.body.appendChild(offscreenCard);

      // 4) 오프스크린 720px 카드만 초고속 html2canvas 렌더링 (0.1초 Instant)
      html2canvas(offscreenCard, {
        backgroundColor: null,
        useCORS: true,
        scale: 1.5,
        logging: false,
        imageTimeout: 0
      }).then(canvas => {
        offscreenCard.remove();

        canvas.toBlob(blob => {
          downloadBlob(blob, `gemini_chat_${Date.now()}.png`);
          try {
            const item = new ClipboardItem({ "image/png": blob });
            navigator.clipboard.write([item]);
          } catch (err) {}
          setBtnLoading(btn, false, originalHTML);
        }, "image/png");
      }).catch(err => {
        offscreenCard.remove();
        alert("이미지 캡처 중 오류가 발생했습니다: " + err.message);
        setBtnLoading(btn, false, originalHTML);
      });
    } catch (err) {
      alert("오프스크린 이미지 처리 중 오류가 발생했습니다: " + err.message);
      setBtnLoading(btn, false, originalHTML);
    }
  }, 50);
}

function exportToJSON(responseEl, btn) {
  const originalHTML = btn ? btn.innerHTML : "JSON";
  setBtnLoading(btn, true, originalHTML);

  setTimeout(() => {
    try {
      let parent = responseEl.parentElement;
      let questionText = "Unknown User Prompt";
      
      while (parent && parent !== document.body) {
        const qNode = parent.querySelector(selectors.userPromptText);
        if (qNode) {
          questionText = qNode.innerText || qNode.textContent;
          break;
        }
        parent = parent.parentElement;
      }

      const clone = responseEl.cloneNode(true);
      const btnContainer = clone.querySelector(".gemini-export-btn-container");
      if (btnContainer) btnContainer.remove();
      const answerText = clone.innerText || clone.textContent;

      const chatJSON = {
        chatId: "chat_" + Date.now(),
        title: questionText.substring(0, 30),
        createdAt: new Date().toISOString(),
        messages: [
          {
            role: "user",
            content: questionText.trim()
          },
          {
            role: "assistant",
            content: answerText.trim()
          }
        ]
      };

      const blob = new Blob([JSON.stringify(chatJSON, null, 2)], { type: "application/json;charset=utf-8" });
      downloadBlob(blob, `gemini_chat_${Date.now()}.json`);
    } catch (err) {
      alert("JSON 변환 중 오류가 발생했습니다: " + err.message);
    } finally {
      setBtnLoading(btn, false, originalHTML);
    }
  }, 100);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ==========================================
   E. 질문 전송 감지 (사용량 카운팅)
   ========================================== */
function setupUsageTracking() {
  let lastCountTime = 0;

  function incrementUsage() {
    const now = Date.now();
    if (now - lastCountTime < 1500) return;
    lastCountTime = now;

    const todayStr = new Date().toISOString().split("T")[0];

    chrome.storage.local.get(["usageData"], (result) => {
      const data = result.usageData || {
        currentDate: todayStr,
        dailyCount: 0,
        weeklyCount: 0,
        history: {}
      };

      if (data.currentDate !== todayStr) {
        data.currentDate = todayStr;
        data.dailyCount = 0;
      }

      data.dailyCount += 1;
      data.weeklyCount += 1;

      if (!data.history) data.history = {};
      data.history[todayStr] = (data.history[todayStr] || 0) + 1;

      chrome.storage.local.set({ usageData: data });

      // 질문 전송 시 즉시 실시간 사용량 동기화 수행
      if (typeof globalRefreshUsageFn === "function") {
        setTimeout(() => globalRefreshUsageFn(), 1000);
      }
    });
  }

  document.addEventListener("click", (e) => {
    const sendBtn = e.target.closest(selectors.sendButton);
    if (sendBtn) {
      incrementUsage();
    }
  });

  document.addEventListener("keydown", (e) => {
    const isTextarea = e.target.matches(selectors.textarea);
    if (isTextarea && e.key === "Enter" && !e.shiftKey) {
      incrementUsage();
    }
  });
}

/* ==========================================
   F. gemini.google.com/usage 연동 및 드래그 앤 드롭 플로팅 사용량 위젯
   ========================================== */
let globalRefreshUsageFn = null;

function fetchGeminiUsage(callback) {
  fetch("https://gemini.google.com/usage", { credentials: "include" })
    .then((response) => {
      if (!response.ok) throw new Error("HTTP error " + response.status);
      return response.text();
    })
    .then((html) => {
      let planName = "PRO";
      let currentVal = "1%";
      let weeklyVal = "3%";
      let currentReset = "오후 2:23에 초기화";
      let weeklyReset = "7월 29일 오전 10:23에 초기화";

      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // DOM 요소 기반 텍스트 노드 추출 시도
        const allTextElements = Array.from(doc.querySelectorAll("div, p, span, td, li"))
          .map(el => (el.innerText || el.textContent || "").trim())
          .filter(txt => txt.length > 0 && txt.length < 200);

        const fullText = doc.body ? (doc.body.innerText || doc.body.textContent || "") : html;

        // 1. Plan 추출
        const planMatch = fullText.match(/\b(PRO|ADVANCED|ULTRA|FREE|STANDARD)\b/i);
        if (planMatch) {
          planName = planMatch[1].toUpperCase();
        }

        // 2. Current 사용량 % 추출
        const currentMatch = fullText.match(/(?:Current|Daily|현재|일일)\s*:?\s*(\d+%)/i) ||
                             fullText.match(/(\d+%)\s*(?:used|consumed|현재)/i);
        if (currentMatch) {
          currentVal = currentMatch[1].endsWith("%") ? currentMatch[1] : (currentMatch[1] + "%");
        }

        // 3. Weekly 사용량 % 추출
        const weeklyMatch = fullText.match(/(?:Weekly|주간)\s*:?\s*(\d+%)/i) ||
                            fullText.match(/Weekly\s*:?\s*(\d+)/i);
        if (weeklyMatch) {
          weeklyVal = weeklyMatch[1].endsWith("%") ? weeklyMatch[1] : (weeklyMatch[1] + "%");
        }

        // 4. 초기화(Reset) 시각 텍스트 파싱
        const resetElements = allTextElements.filter(txt => 
          /초기화|reset|resets|resets at|resets on/i.test(txt)
        );

        let foundCurrentReset = "";
        let foundWeeklyReset = "";

        resetElements.forEach(txt => {
          if (!foundCurrentReset && (/\d{1,2}:\d{2}/.test(txt) || /오[전후]/.test(txt))) {
            if (!/월|\d+일|day|week|monthly/i.test(txt)) {
              foundCurrentReset = txt;
            }
          }
          if (!foundWeeklyReset && (/\d+월|\d+일|Jul|Aug|Sep|Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun/i.test(txt))) {
            foundWeeklyReset = txt;
          }
        });

        if (foundCurrentReset) {
          currentReset = foundCurrentReset;
        } else {
          const m = fullText.match(/(오[전후]\s*\d{1,2}:\d{2}(?:에\s*초기화)?|\d{1,2}:\d{2}\s*(?:AM|PM)?(?:\s*reset)?)/i);
          if (m) currentReset = m[1].includes("초기화") ? m[1] : (m[1] + "에 초기화");
        }

        if (foundWeeklyReset) {
          weeklyReset = foundWeeklyReset;
        } else {
          const m = fullText.match(/(\d+월\s*\d+일\s*오[전후]\s*\d{1,2}:\d{2}(?:에\s*초기화)?|\w+\s*\d+.*?(?:AM|PM).*?reset)/i);
          if (m) weeklyReset = m[1].includes("초기화") ? m[1] : (m[1] + "에 초기화");
        }

        // Percent list fallback
        if (!currentMatch && !weeklyMatch) {
          const percentList = fullText.match(/(\d+)\s*%/g);
          if (percentList && percentList.length >= 2) {
            currentVal = percentList[0];
            weeklyVal = percentList[1];
          } else if (percentList && percentList.length === 1) {
            currentVal = percentList[0];
          }
        }
      } catch (e) {
        console.warn("Usage parsing warning:", e);
      }

      const usageInfo = {
        plan: planName,
        current: currentVal,
        weekly: weeklyVal,
        currentReset: currentReset,
        weeklyReset: weeklyReset,
        updatedAt: Date.now()
      };
      safeStorageLocalSet({ usageFetchedData: usageInfo });
      if (callback) callback(usageInfo);
    })
    .catch((err) => {
      console.warn("Failed to fetch https://gemini.google.com/usage:", err);
      safeStorageLocalGet(["usageFetchedData"], (result) => {
        const fallback = result.usageFetchedData || {
          plan: "PRO",
          current: "1%",
          weekly: "3%",
          currentReset: "오후 2:23에 초기화",
          weeklyReset: "7월 29일 오전 10:23에 초기화"
        };
        if (callback) callback(fallback);
      });
    });
}

function setupUsageFloatingWidget() {
  let widget = document.getElementById("gemini-usage-widget");
  if (widget) return;

  widget = document.createElement("div");
  widget.id = "gemini-usage-widget";
  widget.innerHTML = `
    <!-- Header -->
    <div class="gemini-usage-header">
      <div class="gemini-usage-badge" id="gemini-usage-badge">PRO</div>
      
      <!-- Compact View Body -->
      <div class="gemini-usage-compact-body">
        <div class="gemini-usage-item">Current: <span class="val" id="gemini-usage-current-compact">1%</span></div>
        <div class="gemini-usage-item">Weekly: <span class="val" id="gemini-usage-weekly-compact">3%</span></div>
      </div>

      <!-- Actions -->
      <div class="gemini-usage-actions">
        <button class="gemini-usage-btn" id="gemini-usage-refresh-btn" title="수동 동기화">
          <svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
        </button>
        <button class="gemini-usage-btn" id="gemini-usage-toggle-btn" title="접기/펼치기">
          <svg viewBox="0 0 24 24" id="gemini-usage-toggle-icon"><path d="M12 16l6-6-1.41-1.41L12 13.17 7.41 8.59 6 10z"/></svg>
        </button>
        <button class="gemini-usage-btn" id="gemini-usage-close-btn" title="닫기">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
    </div>

    <!-- Expanded View Body (Detailed View) -->
    <div class="gemini-usage-expanded-body">
      <div class="gemini-usage-divider"></div>
      
      <!-- Current Usage Section -->
      <div class="gemini-usage-section">
        <div class="gemini-usage-row-top">
          <span class="gemini-usage-label">Current Usage</span>
          <span class="gemini-usage-reset-time" id="gemini-usage-current-reset">오후 2:23에 초기화</span>
        </div>
        <div class="gemini-usage-row-bottom">
          <div class="gemini-usage-progress-bar">
            <div class="gemini-usage-progress-fill" id="gemini-usage-current-bar" style="width: 1%;"></div>
          </div>
          <span class="gemini-usage-percent-text" id="gemini-usage-current-expanded">1%</span>
        </div>
      </div>

      <!-- Weekly Limit Section -->
      <div class="gemini-usage-section">
        <div class="gemini-usage-row-top">
          <span class="gemini-usage-label">Weekly Limit</span>
          <span class="gemini-usage-reset-time" id="gemini-usage-weekly-reset">7월 29일 오전 10:23에 초기화</span>
        </div>
        <div class="gemini-usage-row-bottom">
          <div class="gemini-usage-progress-bar">
            <div class="gemini-usage-progress-fill" id="gemini-usage-weekly-bar" style="width: 3%;"></div>
          </div>
          <span class="gemini-usage-percent-text" id="gemini-usage-weekly-expanded">3%</span>
        </div>
      </div>

      <!-- Footer Collapse Button -->
      <div class="gemini-usage-footer">
        <button class="gemini-usage-footer-btn" id="gemini-usage-footer-toggle-btn" title="접기">
          <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:currentColor;"><path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"/></svg>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(widget);

  // 저장된 위치 및 확장 모드 복원
  safeStorageLocalGet(["usageWidgetPos", "usageFetchedData"], (res) => {
    const pos = res.usageWidgetPos || { top: "20px", left: "calc(50% - 130px)", isExpanded: false };
    widget.style.top = pos.top || "20px";
    widget.style.left = pos.left || "calc(50% - 130px)";

    if (pos.isExpanded) {
      widget.classList.add("expanded");
      updateToggleIcons(true);
    } else {
      widget.classList.remove("expanded");
      updateToggleIcons(false);
    }

    if (res.usageFetchedData) {
      updateUsageUI(res.usageFetchedData);
    }
  });

  // 테마 설정 (시스템 / 다크 / 라이트) 로드 및 동기화
  function updateWidgetTheme(themeSetting) {
    let effectiveTheme = themeSetting;
    if (themeSetting === "system") {
      effectiveTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    widget.setAttribute("data-theme", effectiveTheme);
  }

  safeStorageLocalGet(["themeSetting"], (res) => {
    updateWidgetTheme(res.themeSetting || "system");
  });

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes.themeSetting) {
        updateWidgetTheme(changes.themeSetting.newValue);
      }
    });
  }

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    safeStorageLocalGet(["themeSetting"], (res) => {
      if ((res.themeSetting || "system") === "system") {
        updateWidgetTheme("system");
      }
    });
  });

  globalRefreshUsageFn = refreshUsageData;

  // 초기 로드 시 동기화
  refreshUsageData();

  // 1분 주기 자동 동기화 타이머
  setInterval(() => {
    refreshUsageData();
  }, 60000);

  // 1. 드래그 앤 드롭 핸들러
  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  widget.addEventListener("mousedown", (e) => {
    if (e.target.closest(".gemini-usage-btn") || e.target.closest(".gemini-usage-footer-btn")) return;

    isDragging = true;
    widget.classList.add("gemini-widget-dragging");

    const rect = widget.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    let newLeft = e.clientX - offsetX;
    let newTop = e.clientY - offsetY;

    const maxLeft = window.innerWidth - widget.offsetWidth;
    const maxTop = window.innerHeight - widget.offsetHeight;

    newLeft = Math.max(10, Math.min(maxLeft - 10, newLeft));
    newTop = Math.max(10, Math.min(maxTop - 10, newTop));

    widget.style.left = `${newLeft}px`;
    widget.style.top = `${newTop}px`;
  });

  document.addEventListener("mouseup", () => {
    if (!isDragging) return;
    isDragging = false;
    widget.classList.remove("gemini-widget-dragging");

    saveWidgetState();
  });

  // 2. 수동 동기화 버튼 (↻)
  const refreshBtn = document.getElementById("gemini-usage-refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      refreshBtn.classList.add("spinning");
      refreshUsageData(() => {
        setTimeout(() => refreshBtn.classList.remove("spinning"), 600);
      });
    });
  }

  // 3. 접기/펼치기 버튼 (헤더 버튼 & 하단 화살표)
  const toggleBtn = document.getElementById("gemini-usage-toggle-btn");
  const footerToggleBtn = document.getElementById("gemini-usage-footer-toggle-btn");

  function toggleExpandState() {
    const isExpanded = widget.classList.toggle("expanded");
    updateToggleIcons(isExpanded);
    saveWidgetState();
  }

  if (toggleBtn) toggleBtn.addEventListener("click", toggleExpandState);
  if (footerToggleBtn) footerToggleBtn.addEventListener("click", toggleExpandState);

  // 4. 닫기 버튼
  const closeBtn = document.getElementById("gemini-usage-close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      widget.classList.add("hidden");
    });
  }

  function updateToggleIcons(isExpanded) {
    const headerIcon = document.getElementById("gemini-usage-toggle-icon");
    if (!headerIcon) return;
    if (isExpanded) {
      // 펼쳐진 상태 -> 접기 화살표 (위쪽 화살표)
      headerIcon.innerHTML = `<path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"/>`;
    } else {
      // 접힌 상태 -> 펼치기 화살표 (아래쪽 화살표)
      headerIcon.innerHTML = `<path d="M12 16l6-6-1.41-1.41L12 13.17 7.41 8.59 6 10z"/>`;
    }
  }

  function saveWidgetState() {
    safeStorageLocalGet(["usageWidgetPos"], (res) => {
      const currentPos = res.usageWidgetPos || {};
      currentPos.top = widget.style.top;
      currentPos.left = widget.style.left;
      currentPos.isExpanded = widget.classList.contains("expanded");
      safeStorageLocalSet({ usageWidgetPos: currentPos });
    });
  }

  function refreshUsageData(cb) {
    fetchGeminiUsage((data) => {
      updateUsageUI(data);
      if (cb) cb();
    });
  }

  function updateUsageUI(data) {
    if (!data) return;
    const badgeEl = document.getElementById("gemini-usage-badge");
    const compactCurrentEl = document.getElementById("gemini-usage-current-compact");
    const compactWeeklyEl = document.getElementById("gemini-usage-weekly-compact");

    const expandedCurrentEl = document.getElementById("gemini-usage-current-expanded");
    const expandedWeeklyEl = document.getElementById("gemini-usage-weekly-expanded");
    const currentBarEl = document.getElementById("gemini-usage-current-bar");
    const weeklyBarEl = document.getElementById("gemini-usage-weekly-bar");

    const currentResetEl = document.getElementById("gemini-usage-current-reset");
    const weeklyResetEl = document.getElementById("gemini-usage-weekly-reset");

    if (badgeEl && data.plan) badgeEl.innerText = data.plan;

    // Compact Mode UI
    if (compactCurrentEl && data.current) compactCurrentEl.innerText = data.current;
    if (compactWeeklyEl && data.weekly) compactWeeklyEl.innerText = data.weekly;

    // Expanded Mode UI
    if (expandedCurrentEl && data.current) expandedCurrentEl.innerText = data.current;
    if (expandedWeeklyEl && data.weekly) expandedWeeklyEl.innerText = data.weekly;

    if (currentResetEl && data.currentReset) currentResetEl.innerText = data.currentReset;
    if (weeklyResetEl && data.weeklyReset) weeklyResetEl.innerText = data.weeklyReset;

    // Progress Bar Fill Width
    if (currentBarEl && data.current) {
      const num = parseInt(data.current.replace("%", ""), 10) || 0;
      currentBarEl.style.width = `${Math.min(100, Math.max(0, num))}%`;
    }
    if (weeklyBarEl && data.weekly) {
      const num = parseInt(data.weekly.replace("%", ""), 10) || 0;
      weeklyBarEl.style.width = `${Math.min(100, Math.max(0, num))}%`;
    }
  }
}

/* ==========================================
   G. 대화창 너비(Width) 팝업 연동 수신기 (Popup Connected Chat Width Sync)
   ========================================== */
function setupChatWidthController() {
  // 웹 UI 화면 상에 남아있는 슬라이더 바 요소 제거 (팝업에서 통합 관리)
  const oldBar = document.getElementById("gemini-chat-width-bar");
  if (oldBar) oldBar.remove();

  function applyChatWidth(widthVal) {
    if (!widthVal) return;
    document.documentElement.style.setProperty("--gemini-chat-width", widthVal);
  }

  // 저장된 너비 로드 및 대화창에 적용
  safeStorageLocalGet(["customChatWidth"], (res) => {
    const savedWidth = res.customChatWidth || "960px";
    applyChatWidth(savedWidth);
  });

  // 팝업 창에서 대화창 너비 슬라이더 변경 시 실시간 수신 및 반영
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes.customChatWidth) {
        applyChatWidth(changes.customChatWidth.newValue);
      }
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "refreshSelectors") {
    init();
    sendResponse({ status: "refreshed" });
  }
});

// 초기 실행
init();



