import React, { useEffect } from "react";
import { useSettingsStore } from "@stores/useSettingsStore";
import { ReactComponent as Github } from "@assets/svgs/github.svg";
import { ReactComponent as Bug } from "@assets/svgs/bug.svg";
import Checkbox from "@components/Checkbox";
import Radio from "@components/Radio";
import { ReactComponent as ResetIcon } from "@assets/svgs/sparkles.svg";

export default function SettingTab({ showAlert, showConfirm }) {
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
  const handleAngleModeChange = async (e) => {
    const newMode = e.target.value;

    showConfirm(
      "렌더링 설정을 적용하려면 앱을 재시작해야 합니다. 지금 재시작하시겠습니까?",
      () => {
        setAngleMode(newMode);
        ipcRenderer.send("set-angle-mode", newMode);
        ipcRenderer.send("restart-app");
      }
    );
  };

  return (
    <div className="settings-scroll w-full h-full flex flex-col p-[18px] gap-[18px] overflow-y-auto">
      <div className="w-full bg-[#1C1E25] rounded-[6px] px-[18px]">
        <div className="flex items-center justify-between h-[51px] w-full pl-[117px] pr-[180px]">
          <p className="text-center font-normal w-[153px] text-white text-[13.5px]">
            오버레이 창 고정
          </p>
          <Checkbox
            checked={overlayLocked}
            onChange={handleOverlayLockChange}
          />
        </div>
        <div className="w-full h-[0.75px] bg-[#3C4049]" />
        <div className="flex items-center justify-between h-[51px] w-full pl-[117px] pr-[180px]">
          <p className="text-center font-normal w-[153px] text-white text-[13.5px]">
            항상 위에 표시
          </p>
          <Checkbox checked={alwaysOnTop} onChange={handleAlwaysOnTopChange} />
        </div>
        <div className="w-full h-[0.75px] bg-[#3C4049]" />
        <div className="flex items-center justify-between h-[51px] w-full pl-[117px] pr-[180px]">
          <p className="text-center font-normal w-[153px] text-white text-[13.5px]">
            하드웨어 가속 활성화
          </p>
          <Checkbox
            checked={hardwareAcceleration}
            onChange={handleHardwareAccelerationChange}
          />
        </div>
        <div className="w-full h-[0.75px] bg-[#3C4049]" />
        <div className="flex items-center justify-between h-[51px] w-full pl-[117px] pr-[180px]">
          <p className="text-center font-normal w-[153px] text-white text-[13.5px]">
            노트 효과 표시
          </p>
          <Checkbox checked={noteEffect} onChange={handleNoteEffectChange} />
        </div>
        {/* <div className="w-full h-[0.75px] bg-[#3C4049]" />
        <div className="flex items-center justify-between h-[51px] w-full pl-[117px] pr-[180px]">
          <p className="text-center font-normal w-[153px] text-white text-[13.5px]">
            키 입력 카운트 표시
            <a 
              className="text-[#419DFF] cursor-pointer "
              onClick={handleResetKeyCount}
            > [초기화]</a>
          </p>
          <Checkbox 
            checked={showKeyCount}
            onChange={handleKeyCountToggle}
          />
        </div> */}
        <div className="w-full h-[0.75px] bg-[#3C4049]" />
        <div className="flex items-center justify-between h-[51px] w-full pl-[117px] pr-[180px]">
          <p className="text-center font-normal w-[153px] text-white text-[13.5px]">
            커스텀 CSS 활성화
          </p>
          <Checkbox checked={useCustomCSS} onChange={handleToggleCustomCSS} />
        </div>
        {useCustomCSS && (
          <>
            <div className="w-full h-[0.75px] bg-[#3C4049]" />
            <div className="flex items-center justify-between h-[51px] w-full">
              <div className="flex w-[50%] justify-center">
                <p className="text-[#989BA6] text-[12px] truncate w-[300px] text-center">
                  {customCSSPath && customCSSPath.length > 0
                    ? customCSSPath
                    : "(CSS 파일이 선택되지 않았습니다)"}
                </p>
              </div>
              <div className="flex w-[50%] justify-end pr-[134px]">
                <button
                  onClick={handleLoadCustomCSS}
                  className="h-[28px] px-3 bg-[#272B33] border border-[rgba(255,255,255,0.1)] rounded-md text-white text-xs"
                >
                  CSS 파일 불러오기
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      <div className="w-full bg-[#1C1E25] rounded-[6px] px-[18px]">
        <div className="flex items-center justify-between h-[51px] w-full pl-[117px] pr-[26px]">
          <p className="text-center font-normal w-[153px] text-white text-[13.5px]">
            그래픽 렌더링 옵션
          </p>
          <div className="flex items-center gap-[40px]">
            {ANGLE_OPTIONS.map((option) => (
              <Radio
                key={option.value}
                name="angle"
                value={option.value}
                checked={angleMode === option.value}
                onChange={handleAngleModeChange}
              >
                {option.label}
              </Radio>
            ))}
          </div>
        </div>
      </div>
      <Footer showConfirm={showConfirm} />
    </div>
  );
}

function Footer({ showConfirm }) {
  const ipcRenderer = window.electron.ipcRenderer;

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
    <div className="flex flex-col justify-between w-full pb-[36px]">
      <div className="flex w-full gap-[18px]">
        <button
          onClick={() =>
            handleClick("https://github.com/lee-sihun/djmax-keyviewer")
          }
          className="flex flex-1 items-center justify-center gap-[7.5px] w-full h-[31px] bg-[#1C1E25] rounded-[6px]"
        >
          <Github className="flex-shrink-0 mb-[3px]" />
          <p className="text-white text-[15px] leading-[16.5px] truncate font-light">
            Github
          </p>
        </button>
        <button
          onClick={() =>
            handleClick("https://github.com/lee-sihun/djmax-keyviewer/issues")
          }
          className="flex flex-1 items-center justify-center gap-[7.5px] w-full h-[31.5px] bg-[#1C1E25] rounded-[6px]"
        >
          <Bug className="flex-shrink-0 mb-[2px]" />
          <p className="text-white text-[15px] leading-[16.5px] truncate font-light">
            Bug Report
          </p>
        </button>
        <button
          onClick={handleResetAll}
          className="flex justify-center items-center w-[42px] bg-[#1C1E25]  rounded-[6px]"
        >
          <ResetIcon />
        </button>
      </div>
      <div className="flex-col w-full gap-[4px] justify-center items-center mt-[18px]">
        <p className="text-[#D8DADF] text-[10.5px] text-center font-light">
          본 프로그램은 NEOWIZ 또는 DJMAX RESPECT V 공식 개발사와 아무런 관련이
          없습니다.
        </p>
        <p className="text-[#989BA6] text-[10.5px] text-center font-light">
          (Ver 1.0.6)
        </p>
      </div>
    </div>
  );
}
