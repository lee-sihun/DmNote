import React, { useEffect } from "react";
import { useSettingsStore } from "@stores/useSettingsStore";
import Checkbox from "@components/main/common/Checkbox";
import Dropdown from "@components/main/common/Dropdown";

export default function Settings({ showAlert, showConfirm }) {
  const {
    hardwareAcceleration,
    setHardwareAcceleration,
    alwaysOnTop,
    setAlwaysOnTop,
    // showKeyCount,
    // setShowKeyCount,
    overlayLocked,
    setOverlayLocked,
    angleMode,
    setAngleMode,
    noteEffect,
    setNoteEffect,
    useCustomCSS,
    setUseCustomCSS,
    customCSSContent,
    setCustomCSSContent,
    customCSSPath,
    setCustomCSSPath,
  } = useSettingsStore();
  const ipcRenderer = window.electron.ipcRenderer;

  const [overlayResizeAnchor, setOverlayResizeAnchor] =
    React.useState("top-left");

  const RESIZE_ANCHOR_OPTIONS = [
    { value: "top-left", label: "좌상단" },
    { value: "bottom-left", label: "좌하단" },
    { value: "top-right", label: "우상단" },
    { value: "bottom-right", label: "우하단" },
    { value: "center", label: "가운데" },
  ];

  const ANGLE_OPTIONS = [
    {
      value: "d3d11",
      label: "Direct3D 11",
    },
    {
      value: "d3d9",
      label: "Direct3D 9",
    },
    {
      value: "gl",
      label: "OpenGL",
    },
  ];

  useEffect(() => {
    const updateHandler = (_, value) => {
      setHardwareAcceleration(value);
    };

    const alwaysOnTopHandler = (_, value) => {
      setAlwaysOnTop(value);
    };

    // const showKeyCountHandler = (_, value) => {
    //   setShowKeyCount(value);
    // };

    const overlayLockHandler = (_, value) => {
      setOverlayLocked(value);
    };

    const noteEffectHandler = (_, value) => {
      setNoteEffect(value);
    };

    // CSS 초기화 핸들러
    const resetCompleteHandler = () => {
      setUseCustomCSS(false);
      setCustomCSSContent("");
      setCustomCSSPath("");
    };

    ipcRenderer.send("get-hardware-acceleration");
    ipcRenderer.on("update-hardware-acceleration", updateHandler);

    ipcRenderer.send("get-always-on-top");
    ipcRenderer.on("update-always-on-top", alwaysOnTopHandler);

    // ipcRenderer.send('get-show-key-count');
    // ipcRenderer.on('update-show-key-count', showKeyCountHandler);

    ipcRenderer.send("get-overlay-lock");
    ipcRenderer.on("update-overlay-lock", overlayLockHandler);

    ipcRenderer.send("get-note-effect");
    ipcRenderer.on("update-note-effect", noteEffectHandler);

    // CSS 초기화 이벤트 리스너 추가
    ipcRenderer.on("resetComplete", resetCompleteHandler);

    ipcRenderer.invoke("get-angle-mode").then((mode) => {
      setAngleMode(mode);
    });

    ipcRenderer
      .invoke("get-use-custom-css")
      .then((enabled) => {
        setUseCustomCSS(enabled);
      })
      .catch(() => {});

    ipcRenderer
      .invoke("get-custom-css")
      .then((data) => {
        if (data && data.content) setCustomCSSContent(data.content);
        if (data && data.path) setCustomCSSPath(data.path);
      })
      .catch(() => {});

    // overlay resize anchor 초기값
    ipcRenderer
      .invoke("get-overlay-resize-anchor")
      .then((val) => {
        if (val) setOverlayResizeAnchor(val);
      })
      .catch(() => {});

    return () => {
      ipcRenderer.removeAllListeners("update-hardware-acceleration");
      ipcRenderer.removeAllListeners("update-always-on-top");
      // ipcRenderer.removeAllListeners('update-show-key-count');
      ipcRenderer.removeAllListeners("update-overlay-lock");
      ipcRenderer.removeAllListeners("update-note-effect");
      ipcRenderer.removeAllListeners("resetComplete");
    };
  }, []);

  const handleHardwareAccelerationChange = async () => {
    const newState = !hardwareAcceleration;

    showConfirm(
      "설정을 적용하려면 재시작해야 합니다. 지금 재시작하시겠습니까?",
      async () => {
        setHardwareAcceleration(newState);
        await ipcRenderer.invoke("toggle-hardware-acceleration", newState);
        ipcRenderer.send("restart-app");
      }
    );
  };

  const handleOverlayResizeAnchorChange = async (e) => {
    const val = e.target.value;
    setOverlayResizeAnchor(val);
    try {
      await ipcRenderer.invoke("set-overlay-resize-anchor", val);
    } catch (err) {
      // ignore
    }
  };

  const handleAlwaysOnTopChange = () => {
    const newState = !alwaysOnTop;
    setAlwaysOnTop(newState);
    ipcRenderer.send("toggle-always-on-top", newState);
  };

  // 키 카운트 On/Off 핸들러
  // const handleKeyCountToggle = () => {
  //   const newState = !showKeyCount;
  //   setShowKeyCount(newState);
  //   ipcRenderer.send('toggle-show-key-count', newState);
  // };

  // 키 카운트 초기화 핸들러
  // const handleResetKeyCount = () => {
  //   ipcRenderer.send('reset-key-count');
  // };

  // 오버레이 창 고정 핸들러
  const handleOverlayLockChange = () => {
    const newState = !overlayLocked;
    setOverlayLocked(newState);
    ipcRenderer.send("toggle-overlay-lock", newState);
  };

  // 커스텀 CSS 핸들러
  const handleToggleCustomCSS = () => {
    const newState = !useCustomCSS;
    setUseCustomCSS(newState);
    ipcRenderer.send("toggle-custom-css", newState);
    // 경로/내용 비어있을 때 활성화하면 안내 유지
    if (newState && (!customCSSPath || customCSSPath.length === 0)) {
      // 내용이 없으면 초기 문자열 유지 (별도 처리 불필요)
    }
  };

  const handleLoadCustomCSS = async () => {
    if (!useCustomCSS) return; // 비활성화 상태면 동작하지 않도록 함
    const result = await ipcRenderer.invoke("load-custom-css");
    if (result && result.success && result.content) {
      setCustomCSSContent(result.content);
      if (result.path) setCustomCSSPath(result.path);
      ipcRenderer.send("update-custom-css", result.content);
      if (!useCustomCSS) handleToggleCustomCSS();
      showAlert("CSS 파일이 로드되었습니다.");
    } else if (result && result.error) {
      showAlert("CSS 파일 로드 실패: " + result.error);
    }
  };

  // 노트 효과 핸들러
  const handleNoteEffectChange = () => {
    const newState = !noteEffect;
    setNoteEffect(newState);
    ipcRenderer.send("toggle-note-effect", newState);
  };

  // 그래픽 렌더링 모드 변경 핸들러
  // const handleAngleModeChange = async (e) => {
  //   const newMode = e.target.value;

  //   showConfirm(
  //     "렌더링 설정을 적용하려면 앱을 재시작해야 합니다. 지금 재시작하시겠습니까?",
  //     () => {
  //       setAngleMode(newMode);
  //       ipcRenderer.send("set-angle-mode", newMode);
  //       ipcRenderer.send("restart-app");
  //     }
  //   );
  // };

  // 그래픽 렌더링 모드 변경 핸들러
  const handleAngleModeChangeSelect = (val) => {
    showConfirm(
      "렌더링 설정을 적용하려면 앱을 재시작해야 합니다. 지금 재시작하시겠습니까?",
      () => {
        setAngleMode(val);
        ipcRenderer.send("set-angle-mode", val);
        ipcRenderer.send("restart-app");
      }
    );
  };

  const handleClick = (link) => {
    ipcRenderer.send("open-external", link);
  };

  const handleResetAll = () => {
    if (showConfirm) {
      showConfirm(
        "모든 설정을 초기화하시겠습니까?",
        () => {
          ipcRenderer.send("reset-keys");
        },
        "초기화"
      );
    } else {
      ipcRenderer.send("reset-keys");
    }
  };

  return (
    <div className="relative w-full h-full">
      <div className="settings-scroll w-full h-full flex flex-col py-[10px] px-[10px] gap-[19px] overflow-y-auto bg-[#0B0B0D]">
        {/* 설정 */}
        <div className="flex flex-row gap-[19px]">
          <div className="flex flex-col gap-[10px] w-[348px]">
            {/* 키뷰어 설정 */}
            <div className="flex flex-col p-[19px] bg-primary rounded-[7px] gap-[24px]">
              <div className="flex flex-row justify-between items-center">
                <p className="text-style-3 text-[#FFFFFF]">오버레이 창 고정</p>
                <Checkbox
                  checked={overlayLocked}
                  onChange={handleOverlayLockChange}
                />
              </div>
              <div className="flex flex-row justify-between items-center">
                <p className="text-style-3 text-[#FFFFFF]">항상 위에 표시</p>
                <Checkbox
                  checked={alwaysOnTop}
                  onChange={handleAlwaysOnTopChange}
                />
              </div>
              <div className="flex flex-row justify-between items-center">
                <p className="text-style-3 text-[#FFFFFF]">노트 효과 표시</p>
                <Checkbox
                  checked={noteEffect}
                  onChange={handleNoteEffectChange}
                />
              </div>
              <div className="flex flex-row justify-between items-center">
                <p className="text-style-3 text-[#FFFFFF]">커스텀 CSS 활성화</p>
                <Checkbox
                  checked={useCustomCSS}
                  onChange={handleToggleCustomCSS}
                />
              </div>
              <div className="flex flex-row justify-between items-center">
                <p
                  className={
                    "text-[12px] truncate max-w-[150px] " +
                    (useCustomCSS ? "text-[#989BA6]" : "text-[#44464E]")
                  }
                >
                  {customCSSPath && customCSSPath.length > 0
                    ? customCSSPath
                    : "(CSS 파일이 선택되지 않았습니다)"}
                </p>
                <button
                  onClick={handleLoadCustomCSS}
                  disabled={!useCustomCSS}
                  className={
                    "py-[4px] px-[8px] bg-[#2A2A31] border-[1px] border-[#3A3944] rounded-[7px] text-style-2 " +
                    (useCustomCSS
                      ? "text-[#DBDEE8]"
                      : "text-[#44464E] cursor-not-allowe1d bg-[#222228] border-[#31303C]")
                  }
                >
                  CSS 파일 불러오기
                </button>
              </div>
              <div className="flex flex-row justify-between items-center">
                <p className="text-style-3 text-[#FFFFFF]">리사이즈 기준점</p>
                <Dropdown
                  options={RESIZE_ANCHOR_OPTIONS}
                  value={overlayResizeAnchor}
                  onChange={async (val) => {
                    setOverlayResizeAnchor(val);
                    try {
                      await ipcRenderer.invoke(
                        "set-overlay-resize-anchor",
                        val
                      );
                    } catch (err) {}
                  }}
                  placeholder="기준점 선택"
                />
              </div>
            </div>
            {/* 기타 설정 */}
            <div className="flex flex-col p-[19px] bg-primary rounded-[7px] gap-[24px]">
              <div className="flex flex-row justify-between items-center">
                <p className="text-style-3 text-[#FFFFFF]">
                  그래픽 렌더링 옵션
                </p>
                <Dropdown
                  options={ANGLE_OPTIONS}
                  value={angleMode}
                  onChange={handleAngleModeChangeSelect}
                  placeholder="렌더링 모드 선택"
                />
              </div>
              {/* 버전 및 설정 초기화 */}
              <div className="flex justify-between items-center py-[14px] px-[12px] bg-[#101013] rounded-[7px]">
                <p className="text-style-3 text-[#FFFFFF]">Ver 1.1.0</p>
                <button
                  className="bg-[#401C1D] rounded-[7px] py-[4px] px-[9px] text-style-2 text-[#E8DBDB]"
                  onClick={handleResetAll}
                >
                  데이터 초기화
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute top-[10px] right-[10px] w-[522px] h-[366px] bg-white rounded-[7px] pointer-events-none"></div>
    </div>
  );
}
