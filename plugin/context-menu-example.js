// @id: context-menu-example

/**
 * 컨텍스트 메뉴 확장 API 예제 플러그인
 *
 * 이 플러그인은 다음 기능을 시연합니다:
 * 1. 키 컨텍스트 메뉴에 커스텀 아이템 추가
 * 2. 그리드 컨텍스트 메뉴에 커스텀 아이템 추가
 * 3. 조건부 표시/비활성화
 * 4. 동적 메뉴 아이템 업데이트
 * 5. 스토리지를 활용한 상태 저장
 */

// 메인 윈도우에서만 실행
if (dmn.window.type !== "main") return;

console.log("[Context Menu Example] Plugin loaded");

// 메뉴 ID 저장
const menuIds = [];

// 상태 관리
let highlightMode = false;
let highlightMenuId = null; // ============================================================
// 1. 키 컨텍스트 메뉴: 키 정보 복사
// ============================================================
menuIds.push(
  dmn.ui.contextMenu.addKeyMenuItem({
    id: "copy-key-info",
    label: "키 정보 복사",
    position: "top", // 기본 메뉴 위에 표시
    onClick: async (context) => {
      const info = `키 코드: ${context.keyCode}\n인덱스: ${
        context.index
      }\n모드: ${context.mode}\n카운트: ${context.position.count || 0}`;

      try {
        await navigator.clipboard.writeText(info);
        console.log("[Context Menu Example] 키 정보 복사됨:", info);
        alert("키 정보가 클립보드에 복사되었습니다!");
      } catch (error) {
        console.error("[Context Menu Example] 복사 실패:", error);
        alert("복사 실패: " + error.message);
      }
    },
  })
);

// ============================================================
// 2. 키 컨텍스트 메뉴: 카운트 기반 조건부 표시
// ============================================================
menuIds.push(
  dmn.ui.contextMenu.addKeyMenuItem({
    id: "reset-if-high-count",
    label: "고빈도 키 카운트 초기화",
    position: "bottom",
    // 카운트가 100 이상일 때만 표시
    visible: (context) => (context.position.count || 0) >= 100,
    onClick: async (context) => {
      const confirmed = confirm(
        `${context.keyCode}의 카운트(${context.position.count})를 초기화하시겠습니까?`
      );

      if (confirmed) {
        console.log(`[Context Menu Example] 카운트 초기화: ${context.keyCode}`);
        // 실제 카운트 초기화 로직은 현재 API에 없으므로 로그만 출력
        alert("카운트가 초기화되었습니다! (시뮬레이션)");
      }
    },
  })
);

// ============================================================
// 3. 키 컨텍스트 메뉴: 모드 기반 조건부 표시
// ============================================================
menuIds.push(
  dmn.ui.contextMenu.addKeyMenuItem({
    id: "4key-only-action",
    label: "4키 전용 액션",
    // 4key 모드에서만 표시
    visible: (context) => context.mode === "4key",
    // 첫 번째 키는 비활성화
    disabled: (context) => context.index === 0,
    onClick: (context) => {
      console.log("[Context Menu Example] 4키 전용 액션 실행:", context);
      alert(`4키 모드 전용 액션이 실행되었습니다!\n키: ${context.keyCode}`);
    },
  })
);

// ============================================================
// 4. 키 컨텍스트 메뉴: 동적 업데이트 (하이라이트 모드 토글)
// ============================================================
highlightMenuId = dmn.ui.contextMenu.addKeyMenuItem({
  id: "toggle-highlight",
  label: "하이라이트 모드 켜기",
  position: "bottom",
  onClick: async () => {
    highlightMode = !highlightMode;

    // 스토리지에 상태 저장
    await dmn.plugin.storage.set("highlightMode", highlightMode);

    // 메뉴 라벨 업데이트
    dmn.ui.contextMenu.updateMenuItem(highlightMenuId, {
      label: highlightMode ? "하이라이트 모드 끄기" : "하이라이트 모드 켜기",
    });

    console.log(
      `[Context Menu Example] 하이라이트 모드: ${highlightMode ? "ON" : "OFF"}`
    );
    alert(
      `하이라이트 모드가 ${highlightMode ? "활성화" : "비활성화"}되었습니다!`
    );
  },
});

menuIds.push(highlightMenuId);

// ============================================================
// 5. 그리드 컨텍스트 메뉴: 위치 정보 표시
// ============================================================
menuIds.push(
  dmn.ui.contextMenu.addGridMenuItem({
    id: "show-grid-position",
    label: "클릭 위치 표시",
    onClick: (context) => {
      const { dx, dy } = context.position;
      console.log(`[Context Menu Example] 그리드 위치: (${dx}, ${dy})`);
      alert(`클릭 위치: X=${dx}, Y=${dy}\n모드: ${context.mode}`);
    },
  })
);

// ============================================================
// 6. 그리드 컨텍스트 메뉴: 조건부 표시 (특정 모드만)
// ============================================================
menuIds.push(
  dmn.ui.contextMenu.addGridMenuItem({
    id: "add-note-marker",
    label: "노트 마커 추가",
    // 4key 또는 5key 모드에서만 표시
    visible: (context) => context.mode === "4key" || context.mode === "5key",
    onClick: async (context) => {
      const { dx, dy } = context.position;
      console.log(`[Context Menu Example] 노트 마커 추가: (${dx}, ${dy})`);
      alert(`노트 마커가 추가되었습니다! (시뮬레이션)\n위치: (${dx}, ${dy})`);

      // 스토리지에 마커 저장
      const markers =
        (await dmn.plugin.storage.get("noteMarkers")) || [];
      markers.push({
        x: dx,
        y: dy,
        mode: context.mode,
        timestamp: Date.now(),
      });
      await dmn.plugin.storage.set("noteMarkers", markers);

      console.log(`[Context Menu Example] 저장된 마커 수: ${markers.length}`);
    },
  })
);

// ============================================================
// 7. 그리드 컨텍스트 메뉴: 저장된 데이터 확인
// ============================================================
menuIds.push(
  dmn.ui.contextMenu.addGridMenuItem({
    id: "show-markers",
    label: "저장된 마커 보기",
    onClick: async () => {
      const markers =
        (await dmn.plugin.storage.get("noteMarkers")) || [];

      if (markers.length === 0) {
        alert("저장된 마커가 없습니다.");
      } else {
        const markerList = markers
          .map(
            (m, i) =>
              `${i + 1}. (${m.x}, ${m.y}) - ${m.mode} - ${new Date(
                m.timestamp
              ).toLocaleString()}`
          )
          .join("\n");

        console.log("[Context Menu Example] 마커 목록:", markers);
        alert(`저장된 마커 (${markers.length}개):\n\n${markerList}`);
      }
    },
  })
);

// ============================================================
// 초기화: 저장된 상태 복원
// ============================================================
(async () => {
  try {
    // 하이라이트 모드 상태 복원
    const savedHighlightMode =
      (await dmn.plugin.storage.get("highlightMode")) || false;
    highlightMode = savedHighlightMode;

    if (highlightMode && highlightMenuId) {
      dmn.ui.contextMenu.updateMenuItem(highlightMenuId, {
        label: "하이라이트 모드 끄기",
      });
    }

    console.log(
      `[Context Menu Example] 상태 복원 완료 - 하이라이트: ${highlightMode}`
    );
  } catch (error) {
    console.error("[Context Menu Example] 상태 복원 실패:", error);
  }
})();

// ============================================================
// 클린업
// ============================================================
dmn.plugin.registerCleanup(() => {
  console.log("[Context Menu Example] Cleanup called");

  // 방법 1: 개별 제거
  // menuIds.forEach(id => dmn.ui.contextMenu.removeMenuItem(id));

  // 방법 2: 일괄 제거 (권장)
  dmn.ui.contextMenu.clearMyMenuItems();
});

console.log(
  `[Context Menu Example] ${menuIds.length}개의 메뉴 아이템이 추가되었습니다.`
);

