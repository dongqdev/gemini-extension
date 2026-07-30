// popup.js - Gemini Extension Stats & Backup Manager (Remaining Usage & Clipboard JSON Import/Export)

document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements
  const currentUsageVal = document.getElementById("current-usage");
  const currentProgress = document.getElementById("current-progress");
  const currentUsageSub = document.getElementById("current-usage-sub");

  const weeklyUsageVal = document.getElementById("weekly-usage");
  const weeklyProgress = document.getElementById("weekly-progress");
  const weeklyUsageSub = document.getElementById("weekly-usage-sub");

  const btnExportJson = document.getElementById("btn-export-json");
  const btnImportJson = document.getElementById("btn-import-json");
  const btnAiPrompt = document.getElementById("btn-ai-prompt");

  let folders = [];

  // 1. /usage 기반 Gemini 사용량 로드 및 시각화
  function loadUsageStats() {
    chrome.storage.local.get(["usageFetchedData"], (result) => {
      const data = result.usageFetchedData || {
        plan: "PRO",
        current: "14%",
        weekly: "3%",
        currentReset: "오후 7:23에 초기화",
        weeklyReset: "7월 29일 오전 10:23에 초기화"
      };

      const planBadge = document.getElementById("plan-badge");
      if (planBadge && data.plan) planBadge.innerText = data.plan;

      if (currentUsageVal) currentUsageVal.innerHTML = data.current || "14%";
      if (weeklyUsageVal) weeklyUsageVal.innerHTML = data.weekly || "3%";

      if (currentUsageSub) currentUsageSub.innerText = data.currentReset || "오후 7:23에 초기화";
      if (weeklyUsageSub) weeklyUsageSub.innerText = data.weeklyReset || "7월 29일 오전 10:23에 초기화";

      // 프로그래스 바 비율 시각화
      const currentNum = parseInt((data.current || "14%").replace("%", ""), 10) || 14;
      const weeklyNum = parseInt((data.weekly || "3%").replace("%", ""), 10) || 3;

      if (currentProgress) currentProgress.style.width = `${Math.min(100, Math.max(0, currentNum))}%`;
      if (weeklyProgress) weeklyProgress.style.width = `${Math.min(100, Math.max(0, weeklyNum))}%`;
    });

    // 팝업 클릭(열림) 시마다 백그라운드에 최우선 실시간 동기화 요청
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) {
      chrome.runtime.sendMessage({ action: "requestFetchUsage" });
    }
  }

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes.usageFetchedData) {
        loadUsageStats();
      }
    });
  }

  // 2. 폴더 데이터 로드
  function loadFolders() {
    chrome.storage.sync.get(["folders"], (result) => {
      folders = result.folders || [];
    });
  }

  // 3. JSON 내보내기 (파일 다운로드가 아닌 클립보드 복사)
  if (btnExportJson) {
    btnExportJson.addEventListener("click", () => {
      chrome.storage.sync.get(["folders", "customChatTitles"], (result) => {
        const currentFolders = result.folders || folders;
        const customTitles = result.customChatTitles || {};
        
        const backupObject = {
          version: "1.0.0",
          exportedAt: new Date().toISOString(),
          folders: currentFolders,
          customChatTitles: customTitles
        };

        const jsonString = JSON.stringify(backupObject, null, 2);

        navigator.clipboard.writeText(jsonString)
          .then(() => {
            alert("📋 폴더 백업 JSON 데이터가 클립보드에 복사되었습니다!\n원하는 곳이나 메모장에 붙여넣기(Ctrl+V) 하실 수 있습니다.");
          })
          .catch((err) => {
            alert("클립보드 복사 실패: " + err.message);
          });
      });
    });
  }

  // 4. JSON 가져오기 (AI 분류 Mappings 및 백업 JSON 모두 스마트 수용!)
  if (btnImportJson) {
    btnImportJson.addEventListener("click", () => {
      const inputJson = prompt("복사한 AI 분류 결과 또는 백업 JSON 데이터를 여기에 붙여넣으세요 (Ctrl+V):");
      if (inputJson === null) return; // 취소

      const trimmed = inputJson.trim();
      if (!trimmed) {
        alert("⚠️ 붙여넣은 내용이 없습니다.");
        return;
      }

      try {
        const data = JSON.parse(trimmed);

        // A. AI 자동 분류 결과인 경우 (data.mappings 및 선택적 data.newFolders)
        if (data && Array.isArray(data.mappings)) {
          chrome.storage.sync.get(["folders"], (result) => {
            let currentFolders = result.folders || folders || [];
            const mappings = data.mappings;
            const newFolders = Array.isArray(data.newFolders) ? data.newFolders : [];
            let createdFolderCount = 0;
            let appliedCount = 0;

            // 1. 신규 폴더(newFolders)가 전달된 경우 기존 폴더 트리에 동적 동기화 추가
            newFolders.forEach(nf => {
              if (nf.id && nf.name) {
                const exists = currentFolders.some(f => f.id === nf.id || f.name === nf.name);
                if (!exists) {
                  const folderId = nf.id.startsWith("f_") ? nf.id : `f_${Date.now()}_${Math.floor(Math.random()*1000)}`;
                  const newFolderObj = {
                    id: folderId,
                    name: nf.name,
                    color: nf.color || "#3B82F6",
                    parentId: nf.parentId || null,
                    children: [],
                    chatIds: []
                  };
                  currentFolders.push(newFolderObj);
                  createdFolderCount++;

                  // 부모 폴더(parentId)가 존재하는 경우 부모의 children 배열에도 등록!
                  if (nf.parentId) {
                    const parentFolder = currentFolders.find(p => p.id === nf.parentId || p.name === nf.parentId);
                    if (parentFolder) {
                      if (!parentFolder.children) parentFolder.children = [];
                      if (!parentFolder.children.includes(folderId)) {
                        parentFolder.children.push(folderId);
                      }
                      newFolderObj.parentId = parentFolder.id;
                    }
                  }
                }
              }
            });

            // 이미 어떠한 폴더에라도 들어있는 chatId 세트 집계 (기존 유저 배치 100% 보존!)
            const existingAssignedSet = new Set();
            currentFolders.forEach(f => {
              if (f.chatIds) {
                f.chatIds.forEach(cid => existingAssignedSet.add(cid));
              }
            });

            // 2. 대화 매핑 적용
            mappings.forEach(m => {
              if (m.chatId && m.folderId) {
                if (!existingAssignedSet.has(m.chatId)) {
                  // id 또는 name으로 타겟 폴더 탐색
                  let targetFolder = currentFolders.find(f => f.id === m.folderId || f.name === m.folderId);
                  if (targetFolder) {
                    if (!targetFolder.chatIds) targetFolder.chatIds = [];
                    if (!targetFolder.chatIds.includes(m.chatId)) {
                      targetFolder.chatIds.push(m.chatId);
                      existingAssignedSet.add(m.chatId);
                      appliedCount++;
                    }
                  }
                }
              }
            });

            chrome.storage.sync.set({ folders: currentFolders }, () => {
              alert(`✨ AI 자동 분류 완료!\n신규 폴더 ${createdFolderCount}개 생성 및 미분류 대화 ${appliedCount}개가 지정된 위치로 안전하게 추가 배치되었습니다.`);
            });
          });
        }
        // B. 전체 폴더 백업 데이터인 경우 (data.folders)
        else if (data && Array.isArray(data.folders)) {
          folders = data.folders;
          const customChatTitles = data.customChatTitles || {};

          chrome.storage.sync.set({ 
            folders: folders, 
            customChatTitles: customChatTitles 
          }, () => {
            alert("✅ 폴더 구조가 성공적으로 복원되었습니다!");
          });
        } 
        else {
          alert("⚠️ 인식할 수 없는 JSON 형식입니다.\nAI 분류 결과('mappings') 또는 백업('folders') 데이터인지 확인해주세요.");
        }
      } catch (err) {
        alert("❌ JSON 파싱 오류: 올바른 JSON 문법인지 확인해주세요.\n" + err.message);
      }
    });
  }

  // 5. AI 자동 분류 프롬프트 복사 (최상위/하위 폴더 트리 가이드 정밀화!)
  if (btnAiPrompt) {
    btnAiPrompt.addEventListener("click", () => {
      chrome.storage.sync.get(["folders"], (result) => {
        const currentFolders = result.folders || folders;
        const folderSchema = currentFolders.map(f => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId
        }));

        // 이미 어떠한 폴더에라도 들어있는 대화 ID 수집
        const assignedChatIds = [];
        currentFolders.forEach(f => {
          if (f.chatIds && Array.isArray(f.chatIds)) {
            f.chatIds.forEach(id => assignedChatIds.push(id));
          }
        });

        const copyPromptWithChats = (chatList) => {
          const chatsText = Array.isArray(chatList) && chatList.length > 0 
            ? JSON.stringify(chatList, null, 2)
            : "[]";

          const promptText = `너는 나의 웹 브라우저 대화 정리를 돕는 AI 스마트 분류 매니저야.
아래 제공되는 [현재 나의 폴더 트리 구조]와 [분류할 미분류 최근 대화 목록]을 바탕으로 대화를 카테고리별로 정돈해 줘.

[작업 지침]
1. 이미 분류된 대화는 포함되어 있지 않아. 미분류 대화들만 새로 정리해 줘.
2. 기존 폴더 구조 중 적합한 카테고리가 있다면 해당 기존 폴더(id)로 대화를 매핑해 줘.
3. 기존 폴더 중 마땅한 카테고리가 없다면, 주제에 맞는 "신규 폴더(newFolders)"를 필요한 만큼 새로 생성해 줘.
   - 최상위 독립 폴더로 만들고 싶다면 parentId: null 로 명시해.
   - 특정 기존 폴더의 하위 서브폴더로 넣고 싶다면 parentId: "해당기존폴더ID" 로 명시해.

[현재 나의 폴더 트리 구조]
${JSON.stringify(folderSchema, null, 2)}

[요구 결과 JSON 명세]
아래 Schema 형태로만 응답하고, 마크다운 코드 블록이나 기타 설명 텍스트 없이 오직 순수 JSON 데이터만 반환해 줘.
\`\`\`json
{
  "newFolders": [
    { "id": "f_new_1", "name": "신규폴더명", "color": "#3B82F6", "parentId": null }
  ],
  "mappings": [
    { "chatId": "대화ID", "folderId": "기존폴더ID_또는_f_new_1" }
  ]
}
\`\`\`

[분류할 미분류 최근 대화 목록]
${chatsText}`;

          navigator.clipboard.writeText(promptText)
            .then(() => {
              const countStr = Array.isArray(chatList) ? chatList.length : 0;
              if (countStr === 0) {
                alert("✨ 현재 사이드바의 모든 최근 대화가 이미 폴더에 분류되어 있습니다!\n기존 폴더 트리 프롬프트가 복사되었습니다.");
              } else {
                alert(`✨ 아직 분류되지 않은 미분류 최근 대화 ${countStr}개 목록이 100% 자동으로 포함된 AI 분류 프롬프트가 복사되었습니다!\n\nGemini 대화창에 바로 붙여넣기(Ctrl+V) 하시면 AI가 신규 폴더 생성 및 대화 분류를 즉시 수행합니다.`);
              }
            })
            .catch(err => {
              alert("클립보드 복사 실패: " + err.message);
            });
        };

        if (typeof chrome !== "undefined" && chrome.tabs) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].id && tabs[0].url && tabs[0].url.includes("gemini.google.com")) {
              chrome.tabs.sendMessage(tabs[0].id, { action: "getSidebarChats", assignedChatIds: assignedChatIds }, (res) => {
                if (chrome.runtime.lastError) {
                  copyPromptWithChats([]);
                  return;
                }
                const fetchedChats = (res && res.chats) ? res.chats : [];
                copyPromptWithChats(fetchedChats);
              });
            } else {
              copyPromptWithChats([]);
            }
          });
        } else {
          copyPromptWithChats([]);
        }
      });
    });
  }

  // 6. 대화창 너비 슬라이더 조절 기능
  const popupWidthRange = document.getElementById("popup-width-range");
  const popupWidthVal = document.getElementById("popup-width-val");
  const popupPresetBtns = document.querySelectorAll(".popup-preset-btn");

  function setCustomChatWidth(wVal) {
    if (popupWidthVal) popupWidthVal.innerText = wVal;
    if (popupWidthRange && wVal.endsWith("px")) {
      const num = parseInt(wVal.replace("px", ""), 10);
      if (!isNaN(num)) popupWidthRange.value = num;
    }
    chrome.storage.local.set({ customChatWidth: wVal });
  }

  // 저장된 너비 로드
  chrome.storage.local.get(["customChatWidth"], (res) => {
    const w = res.customChatWidth || "960px";
    if (popupWidthVal) popupWidthVal.innerText = w;
    if (popupWidthRange && w.endsWith("px")) {
      const num = parseInt(w.replace("px", ""), 10);
      if (!isNaN(num)) popupWidthRange.value = num;
    }
  });

  if (popupWidthRange) {
    popupWidthRange.addEventListener("input", (e) => {
      const w = `${e.target.value}px`;
      setCustomChatWidth(w);
    });
  }

  popupPresetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const w = btn.getAttribute("data-width");
      if (w) setCustomChatWidth(w);
    });
  });

  // 7. 테마 설정 (시스템 / 다크 / 라이트)
  const themeBtns = document.querySelectorAll("#theme-toggle-group .theme-btn");

  function applyPopupTheme(themeSetting) {
    let activeTheme = themeSetting;
    if (themeSetting === "system") {
      activeTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    document.body.setAttribute("data-theme", activeTheme);

    themeBtns.forEach((btn) => {
      if (btn.getAttribute("data-theme") === themeSetting) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    chrome.storage.local.set({ themeSetting: themeSetting });
  }

  // 저장된 테마 로드
  chrome.storage.local.get(["themeSetting"], (res) => {
    const savedTheme = res.themeSetting || "system";
    applyPopupTheme(savedTheme);
  });

  themeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const theme = btn.getAttribute("data-theme");
      if (theme) applyPopupTheme(theme);
    });
  });

  // 시스템 테마 변경 감지
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    chrome.storage.local.get(["themeSetting"], (res) => {
      if ((res.themeSetting || "system") === "system") {
        applyPopupTheme("system");
      }
    });
  });

  // 초기 로드 실행
  loadUsageStats();
  loadFolders();
});


