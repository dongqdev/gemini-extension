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
        current: "1%",
        weekly: "3%",
        currentReset: "오후 2:23에 초기화",
        weeklyReset: "7월 29일 오전 10:23에 초기화"
      };

      const planBadge = document.getElementById("plan-badge");
      if (planBadge && data.plan) planBadge.innerText = data.plan;

      if (currentUsageVal) currentUsageVal.innerHTML = data.current || "1%";
      if (weeklyUsageVal) weeklyUsageVal.innerHTML = data.weekly || "3%";

      if (currentUsageSub) currentUsageSub.innerText = data.currentReset || "오후 2:23에 초기화";
      if (weeklyUsageSub) weeklyUsageSub.innerText = data.weeklyReset || "7월 29일 오전 10:23에 초기화";

      // 프로그래스 바 비율 시각화
      const currentNum = parseInt((data.current || "1%").replace("%", ""), 10) || 1;
      const weeklyNum = parseInt((data.weekly || "3%").replace("%", ""), 10) || 3;

      if (currentProgress) currentProgress.style.width = `${Math.min(100, Math.max(0, currentNum))}%`;
      if (weeklyProgress) weeklyProgress.style.width = `${Math.min(100, Math.max(0, weeklyNum))}%`;
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

  // 4. JSON 가져오기 (입력창에 붙여넣기 방식)
  if (btnImportJson) {
    btnImportJson.addEventListener("click", () => {
      const inputJson = prompt("복사한 백업 JSON 데이터를 여기에 붙여넣으세요 (Ctrl+V):");
      if (inputJson === null) return; // 취소

      const trimmed = inputJson.trim();
      if (!trimmed) {
        alert("⚠️ 붙여넣은 내용이 없습니다.");
        return;
      }

      try {
        const data = JSON.parse(trimmed);
        if (data && Array.isArray(data.folders)) {
          folders = data.folders;
          const customChatTitles = data.customChatTitles || {};

          chrome.storage.sync.set({ 
            folders: folders, 
            customChatTitles: customChatTitles 
          }, () => {
            alert("✅ 폴더 구조가 성공적으로 복원되었습니다!\nGemini 웹페이지를 새로고침(F5)하세요.");
          });
        } else {
          alert("⚠️ 올바른 JSON 폴더 백업 데이터 형식이 아닙니다.");
        }
      } catch (err) {
        alert("❌ JSON 파싱 오류: 올바른 JSON 문법인지 확인해주세요.\n" + err.message);
      }
    });
  }

  // 5. AI 자동 분류 프롬프트 복사
  if (btnAiPrompt) {
    btnAiPrompt.addEventListener("click", () => {
      chrome.storage.sync.get(["folders"], (result) => {
        const currentFolders = result.folders || folders;
        const folderSchema = currentFolders.map(f => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId
        }));

        const promptText = `너는 나의 웹 브라우저 대화 정리를 돕는 AI 분류 매니저야.
내가 너에게 대화 목록을 JSON으로 줄 테니, 아래 명시된 나의 폴더 카테고리 트리 구조(JSON)를 바탕으로 각 대화(chatId)가 어떤 폴더(folderId)에 매핑되어야 하는지 매핑 목록 JSON을 생성해 줘.

[나의 폴더 트리 구조]
${JSON.stringify(folderSchema, null, 2)}

[요구 결과 JSON 명세]
아래 Schema 형태로만 응답하고, 마크다운 코드 블록이나 기타 텍스트 설명 없이 순수 JSON만 반환해 줘.
\`\`\`json
{
  "mappings": [
    { "chatId": "대화ID", "folderId": "가장적합한폴더ID" }
  ]
}
\`\`\`

분류할 대화 목록은 다음과 같아:
[여기에 제미나이 사이드바에서 복사한 대화 목록 JSON을 붙여넣으세요]`;

        navigator.clipboard.writeText(promptText)
          .then(() => {
            alert("AI 자동 분류 프롬프트가 클립보드에 복사되었습니다!\n제미나이 대화창에 붙여넣고 대화 목록 JSON을 추가하여 실행해 보세요.");
          })
          .catch(err => {
            console.error("클립보드 복사 실패:", err);
          });
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


