import React, { memo, useEffect, useRef } from "react";
import {
  Color,
  WebGLRenderer,
  Scene,
  OrthographicCamera,
  PlaneGeometry,
  ShaderMaterial,
  InstancedMesh,
  InstancedBufferAttribute,
  DynamicDrawUsage,
  NormalBlending,
  Vector2,
  SRGBColorSpace,
} from "three";
import { animationScheduler } from "../../utils/animationScheduler";
import { fadePositionToUniform } from "../../../types/noteSettings";

const MAX_NOTES = 2048; // 씬에서 동시에 렌더링할 수 있는 최대 노트 수

const extractColorStops = (color, fallback = "#FFFFFF") => {
  if (!color) {
    return {
      top: new Color(fallback),
      bottom: new Color(fallback),
      isGradient: false,
    };
  }
  if (typeof color === "string") {
    const solid = new Color(color);
    return { top: solid, bottom: solid.clone(), isGradient: false };
  }
  if (typeof color === "object" && color.type === "gradient") {
    return {
      top: new Color(color.top ?? fallback),
      bottom: new Color(color.bottom ?? fallback),
      isGradient: true,
    };
  }
  const parsed = new Color(fallback);
  return { top: parsed, bottom: parsed.clone(), isGradient: false };
};

// 버텍스 셰이더: 캔버스 로직과 동일한 (위▶아래 좌표계) 계산을 위해 DOM 기준(y 아래로 증가) 값을 받아
// 화면 변환 시 실제 WebGL 상(y 위로 증가)으로 변환 + 라운드 코너 처리를 위한 로컬 좌표 전달.
const vertexShader = `
  uniform float uTime;
  uniform float uFlowSpeed;
  uniform float uScreenHeight; // 전체 화면 높이 (캔버스 y -> WebGL y 변환용)
  uniform float uTrackHeight; // 트랙 높이 (px, runtime 설정)
  uniform float uReverse; // 0.0 = normal (bottom->up), 1.0 = reversed (top->down)
  uniform float uShortThresholdMs; // 단노트 판정 시간(ms)
  uniform float uShortMinLengthPx; // 단노트 최소 길이(px)
  uniform float uDelayEnabled; // 1.0이면 단/롱 딜레이 기능 활성

  attribute vec3 noteInfo; // x: startTime, y: endTime, z: trackX (왼쪽 X px, DOM 기준)
  attribute vec2 noteSize; // x: width, y: trackBottomY (DOM 기준; 키 위치)
  attribute vec4 noteColorTop;
  attribute vec4 noteColorBottom;
  attribute float noteRadius; // 픽셀 단위 라운드 반경
  attribute float trackIndex; // 키 순서 (첫 번째 키 = 0, 두 번째 키 = 1, ...)

  varying vec4 vColorTop;
  varying vec4 vColorBottom;
  varying vec2 vLocalPos;     // 노트 중심 기준 로컬 좌표(px)
  varying vec2 vHalfSize;     // (width/2, height/2)
  varying float vRadius;      // 라운드 반경(px)
  varying float vTrackTopY;   // 트랙 상단 Y 좌표 (DOM 기준)
  varying float vTrackBottomY; // 트랙 하단 Y 좌표 (DOM 기준)
  varying float vReverse;     // 리버스 모드 플래그

  varying float vNoteTopY;
  varying float vNoteBottomY;

  void main() {
    float startTime = noteInfo.x;
    float endTime = noteInfo.y;
    float trackX = noteInfo.z;
    float trackBottomY = noteSize.y; // DOM 기준(위=0 아래=+)
    float noteWidth = noteSize.x;

    // startTime이 0이면 제거된 노트이므로 렌더링하지 않음
    if (startTime == 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
      vColorTop = vec4(0.0);
      vColorBottom = vec4(0.0);
      return;
    }

    bool isActive = endTime == 0.0;
    float rawNoteLength = 0.0;     // 원본 노트 길이
    float bottomCanvasY = 0.0;     // DOM 기준 바닥 y

    if (isActive) {
      rawNoteLength = max(0.0, (uTime - startTime) * uFlowSpeed / 1000.0);
      bottomCanvasY = trackBottomY; // 활성 중엔 바닥 고정
    } else {
      rawNoteLength = max(0.0, (endTime - startTime) * uFlowSpeed / 1000.0);
      float travel = (uTime - endTime) * uFlowSpeed / 1000.0;
      // normal: bottom->up (trackBottomY - travel)
      // reverse: top->down (trackTopY + travel) => noteBottomY will be below top
      float trackTopY_local = trackBottomY - uTrackHeight;
      if (uReverse < 0.5) {
        bottomCanvasY = trackBottomY - travel;
      } else {
        bottomCanvasY = trackTopY_local + travel;
      }
    }

    // 노트 길이를 트랙 높이로 제한 (원본 Track.jsx와 동일한 동작)
    float noteLength = min(rawNoteLength, uTrackHeight);
    
    // 원본 Track.jsx와 동일한 위치 계산: 트랙 컨테이너 내부에서 바닥부터 위로 자라남
    // yPosition = height - noteLength (원본 코드)
    // 트랙 상단 = trackBottomY - uTrackHeight, 트랙 바닥 = trackBottomY
    float noteTopY, noteBottomY;
    
  if (isActive) {
      // 활성 노트: 트랙 바닥부터 위로 자라남 (normal)
      // 활성 노트 in reverse mode should grow from trackTop downward
      if (uReverse < 0.5) {
        noteBottomY = trackBottomY;
        noteTopY = trackBottomY - noteLength;
      } else {
        float trackTopY_local = trackBottomY - uTrackHeight;
        noteTopY = trackTopY_local;
        noteBottomY = trackTopY_local + noteLength;
      }
    } else {
      // 비활성 노트: 이동
      if (uReverse < 0.5) {
        float travel = (uTime - endTime) * uFlowSpeed / 1000.0;
        noteBottomY = trackBottomY - travel;
        noteTopY = noteBottomY - noteLength;
      } else {
        float travel = (uTime - endTime) * uFlowSpeed / 1000.0;
        float trackTopY_local = trackBottomY - uTrackHeight;
        noteTopY = trackTopY_local + travel;
        noteBottomY = noteTopY + noteLength;
      }

      // 단노트(비활성) 최소 픽셀 길이 보정: 타이밍/속도 미스매치 보호
      if (uDelayEnabled > 0.5) {
        float durationMs = max(0.0, endTime - startTime);
        if (durationMs <= uShortThresholdMs) {
          float desired = uShortMinLengthPx;
          float current = noteBottomY - noteTopY;
          if (current < desired) {
            if (uReverse < 0.5) {
              noteTopY = noteBottomY - desired;
            } else {
              noteBottomY = noteTopY + desired;
            }
          }
        }
      }
    }
    
    // 트랙 영역을 벗어나는 경우 클리핑 (트랙 내부로 강제 제한)
    float trackTopY = trackBottomY - uTrackHeight;
    // 노트가 트랙 범위를 넘어 확장되는 것을 방지하기 위해 상/하 경계를 모두 클램프
    noteTopY = max(noteTopY, trackTopY);
    noteBottomY = min(noteBottomY, trackBottomY);

    // 노트가 트랙 범위 밖에 완전히 벗어난 경우 렌더링하지 않음
    if (noteBottomY <= trackTopY) {
      gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
      vColorTop = vec4(0.0);
      vColorBottom = vec4(0.0);
      return;
    }
    
    // 완전히 화면 위로 사라진 경우: 투명 처리
    if (noteBottomY < 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
      vColorTop = vec4(0.0);
      vColorBottom = vec4(0.0);
      return;
    }

    // 실제 렌더링될 노트 길이 재계산
    noteLength = noteBottomY - noteTopY;
    float centerCanvasY = (noteTopY + noteBottomY) / 2.0;

    // WebGL 좌표 변환 (origin bottom-left): DOM top-left 기준 -> bottom-left 기준으로 변환
    float centerWorldY = uScreenHeight - centerCanvasY;

    // 인스턴스 평면 기본 -0.5~0.5 범위 -> 크기 적용
    vec3 transformed = vec3(position.x, position.y, position.z);
    transformed.x *= noteWidth;   // -0.5~0.5 -> 실제 픽셀 폭
    transformed.y *= noteLength;  // -0.5~0.5 -> 실제 픽셀 높이

    // 위치 이동 (x는 왼쪽 정렬, y는 중심 위치로 보정)
    transformed.x += trackX + noteWidth / 2.0;
    transformed.y += centerWorldY;
    
    // Z는 0으로 고정 (키 레이어 순서는 mesh.renderOrder로 제어)
    transformed.z = 0.0;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);

    vColorTop = noteColorTop; // 색상
    vColorBottom = noteColorBottom;
    vHalfSize = vec2(noteWidth, noteLength) * 0.5;
    vLocalPos = vec2(position.x * noteWidth, position.y * noteLength); // 중심 기준 -half~half
    vRadius = noteRadius;
    vTrackTopY = trackTopY;
    vTrackBottomY = trackBottomY;
    vReverse = uReverse;
    vNoteTopY = noteTopY;
    vNoteBottomY = noteBottomY;
  }
`;

// 프래그먼트 셰이더: 개별 노트 페이딩 제거, 상단 50px 전역 마스크 + 라운드 코너 SDF로 픽셀 discard
// gl_FragCoord.y 는 하단=0, 상단=screenHeight 이므로 distanceFromTop = uScreenHeight - gl_FragCoord.y
const fragmentShader = `
  uniform float uScreenHeight;
  uniform float uFadePosition;
  varying vec4 vColorTop;
  varying vec4 vColorBottom;
  varying vec2 vLocalPos;
  varying vec2 vHalfSize;
  varying float vRadius;
  varying float vTrackTopY;
  varying float vTrackBottomY;
  varying float vReverse;
  varying float vNoteTopY;
  varying float vNoteBottomY;

  void main() {
    // 현재 픽셀의 DOM Y 좌표 계산
    float currentDOMY = uScreenHeight - gl_FragCoord.y;
    float trackHeight = max(vTrackBottomY - vTrackTopY, 0.0001);
    float gradientRatio = clamp((currentDOMY - vTrackTopY) / trackHeight, 0.0, 1.0);
    float trackRelativeY = gradientRatio;

    float fadePosFlag = uFadePosition;
    bool fadeDisabled = abs(fadePosFlag - 3.0) < 0.1;
    bool fadeBoth = fadePosFlag > 3.5;
    bool invertForFade = false;
    if (!fadeDisabled && !fadeBoth) {
      if (fadePosFlag < 0.5) {
        invertForFade = (vReverse > 0.5);
      } else if (abs(fadePosFlag - 1.0) < 0.1) {
        invertForFade = false;
      } else if (abs(fadePosFlag - 2.0) < 0.1) {
        invertForFade = true;
      }
    }
    if (!fadeDisabled && !fadeBoth && invertForFade) {
      trackRelativeY = 1.0 - trackRelativeY;
    }

    vec4 baseColor = mix(vColorTop, vColorBottom, gradientRatio);
    float fadeZone = 50.0; // 페이드 영역 50px
    float fadeRatio = fadeZone / trackHeight; // 트랙 높이 대비 페이드 영역 비율

    float alpha = baseColor.a;

    // 라운드 코너: vLocalPos 범위는 -vHalfSize ~ +vHalfSize
    float r = clamp(vRadius, 0.0, min(vHalfSize.x, vHalfSize.y));
    if (r > 0.0) {
      // 사각 SDF with rounding
      vec2 q = abs(vLocalPos) - (vHalfSize - vec2(r));
      float dist = length(max(q, 0.0)) - r;
      // 부드러운 에지 (1px 범위)
      float aa = 1.0; // 안티앨리어싱 폭(px)
      float smoothAlpha = clamp(0.5 - dist / aa, 0.0, 1.0);
      if (dist > 0.5) discard; // 경계 밖
      alpha *= smoothAlpha;
    }

    // 트랙 페이드 영역 적용
    if (fadeBoth) {
      float topFade = clamp(trackRelativeY / fadeRatio, 0.0, 1.0);
      float bottomFade = clamp((1.0 - trackRelativeY) / fadeRatio, 0.0, 1.0);
      alpha *= min(topFade, bottomFade);
    } else if (!fadeDisabled && trackRelativeY < fadeRatio) {
      alpha *= clamp(trackRelativeY / fadeRatio, 0.0, 1.0);
    }

    gl_FragColor = vec4(baseColor.rgb, alpha);
  }
`;

const buildColorAttributes = (color, opacity = 1) => {
  const { top, bottom } = extractColorStops(color);
  const srgbTop = top.clone().convertLinearToSRGB();
  const srgbBottom = bottom.clone().convertLinearToSRGB();
  const clampedOpacity = Math.min(Math.max(opacity, 0), 1);
  return {
    top: [srgbTop.r, srgbTop.g, srgbTop.b, clampedOpacity],
    bottom: [srgbBottom.r, srgbBottom.g, srgbBottom.b, clampedOpacity],
  };
};

export const WebGLTracks = memo(
  ({ tracks, notesRef, subscribe, noteSettings }) => {
    const canvasRef = useRef();
    const rendererRef = useRef();
    const sceneRef = useRef();
    const cameraRef = useRef();
    const geometryRef = useRef();
    const materialRef = useRef();
    const meshMapRef = useRef(new Map()); // 트랙별 InstancedMesh
    const trackMapRef = useRef(new Map());
    const attributesMapRef = useRef(new Map()); // 트랙별 속성 캐싱용
    const colorCacheRef = useRef(new Map()); // 색상 변환 캐싱
    const isAnimating = useRef(false); // 애니메이션 루프 상태
    const noteTrackMapRef = useRef(new Map()); // noteId -> trackKey 매핑

    // 1. WebGL 씬 초기 설정 (단 한번만 실행)
    useEffect(() => {
      const canvas = canvasRef.current;
      const renderer = new WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.sortObjects = true; // 투명 객체 정렬 활성화

      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      rendererRef.current = renderer;

      const scene = new Scene();
      sceneRef.current = scene;

      const camera = new OrthographicCamera(
        0,
        window.innerWidth,
        window.innerHeight,
        0,
        1,
        1000
      );
      camera.position.z = 5;
      cameraRef.current = camera;

      // 공유 지오메트리/머티리얼
      const geometry = new PlaneGeometry(1, 1).toNonIndexed();
      geometryRef.current = geometry;

      const material = new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uFlowSpeed: { value: noteSettings.speed || 180 },
          uScreenHeight: { value: window.innerHeight },
          uTrackHeight: { value: noteSettings.trackHeight || 150 },
          uReverse: { value: noteSettings.reverse ? 1.0 : 0.0 },
          uShortThresholdMs: {
            value: noteSettings.shortNoteThresholdMs || 120,
          },
          uShortMinLengthPx: { value: noteSettings.shortNoteMinLengthPx || 10 },
          uDelayEnabled: {
            value: noteSettings.delayedNoteEnabled ? 1.0 : 0.0,
          },
          uFadePosition: {
            value: fadePositionToUniform(noteSettings.fadePosition),
          },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        blending: NormalBlending,
        depthTest: false, // 투명 객체는 페인터스 알고리즘 사용
        depthWrite: false,
      });
      materialRef.current = material;

      // 트랙 엔트리 생성기
      const createTrackEntry = (track) => {
        const geo = geometryRef.current.clone();
        const mesh = new InstancedMesh(geo, materialRef.current, MAX_NOTES);
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        // 키 순서 고정 레이어링: 첫 번째 키가 가장 뒤 (작은 renderOrder가 먼저 그려짐)
        mesh.renderOrder = track.trackIndex ?? 0;
        sceneRef.current.add(mesh);

        // 트랙별 버퍼
        const noteInfoArray = new Float32Array(MAX_NOTES * 3);
        const noteSizeArray = new Float32Array(MAX_NOTES * 2);
        const noteColorArrayTop = new Float32Array(MAX_NOTES * 4);
        const noteColorArrayBottom = new Float32Array(MAX_NOTES * 4);
        const noteRadiusArray = new Float32Array(MAX_NOTES);
        const trackIndexArray = new Float32Array(MAX_NOTES);

        const noteInfoAttr = new InstancedBufferAttribute(noteInfoArray, 3);
        const noteSizeAttr = new InstancedBufferAttribute(noteSizeArray, 2);
        const noteColorAttrTop = new InstancedBufferAttribute(
          noteColorArrayTop,
          4
        );
        const noteColorAttrBottom = new InstancedBufferAttribute(
          noteColorArrayBottom,
          4
        );
        const noteRadiusAttr = new InstancedBufferAttribute(noteRadiusArray, 1);
        const trackIndexAttr = new InstancedBufferAttribute(trackIndexArray, 1);

        mesh.geometry.setAttribute("noteInfo", noteInfoAttr);
        mesh.geometry.setAttribute("noteSize", noteSizeAttr);
        mesh.geometry.setAttribute("noteColorTop", noteColorAttrTop);
        mesh.geometry.setAttribute("noteColorBottom", noteColorAttrBottom);
        mesh.geometry.setAttribute("noteRadius", noteRadiusAttr);
        mesh.geometry.setAttribute("trackIndex", trackIndexAttr);

        attributesMapRef.current.set(track.trackKey, {
          noteInfoArray,
          noteSizeArray,
          noteColorArrayTop,
          noteColorArrayBottom,
          noteInfoAttr,
          noteSizeAttr,
          noteColorAttrTop,
          noteColorAttrBottom,
          noteRadiusArray,
          noteRadiusAttr,
          trackIndexArray,
          trackIndexAttr,
        });

        meshMapRef.current.set(track.trackKey, {
          mesh,
          noteIndexMap: new Map(),
          freeIndices: [],
          nextIndex: 0,
          gradient: track.gradient,
        });
      };

      const ensureTrackEntry = (trackKey) => {
        if (meshMapRef.current.has(trackKey))
          return meshMapRef.current.get(trackKey);
        const track = trackMapRef.current.get(trackKey);
        if (
          !track ||
          !geometryRef.current ||
          !materialRef.current ||
          !sceneRef.current
        )
          return null;
        createTrackEntry(track);
        return meshMapRef.current.get(trackKey);
      };

      // 애니메이션 루프: GPU에 시간만 전달하고 렌더링
      const animate = (currentTime) => {
        if (
          !rendererRef.current ||
          !sceneRef.current ||
          !cameraRef.current ||
          !materialRef.current
        )
          return;

        const totalNotes = Object.values(notesRef.current).reduce(
          (sum, notes) => sum + notes.length,
          0
        );
        if (totalNotes === 0) {
          for (const { mesh } of meshMapRef.current.values()) {
            if (mesh.count > 0) {
              mesh.count = 0;
            }
          }
          rendererRef.current.render(sceneRef.current, cameraRef.current);
          return;
        }

        materialRef.current.uniforms.uTime.value = currentTime;
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      };

      // 데이터 업데이트 로직을 이벤트 기반으로 변경
      const handleNoteEvent = (event) => {
        if (!event) return;

        const { type, note } = event;

        if (type === "clear") {
          // 모든 노트 클리어
          for (const [, entry] of meshMapRef.current) {
            entry.noteIndexMap.clear();
            entry.freeIndices.length = 0;
            entry.nextIndex = 0;
            entry.mesh.count = 0;
          }
          noteTrackMapRef.current.clear();
          if (isAnimating.current) {
            animationScheduler.remove(animate);
            isAnimating.current = false;
            // 캔버스 클리어
            requestAnimationFrame(() => {
              if (!rendererRef.current) return;
              const { width, height } = rendererRef.current.getSize(
                new Vector2()
              );
              rendererRef.current.setScissor(0, 0, width, height);
              rendererRef.current.clear();
            });
          }
          return;
        }

        if (!note) return;

        if (type === "add") {
          const track = trackMapRef.current.get(note.keyName);
          if (!track) return;

          const entry = ensureTrackEntry(note.keyName);
          if (!entry) return;

          if (!isAnimating.current) {
            animationScheduler.add(animate);
            isAnimating.current = true;
          }

          const { mesh, noteIndexMap, freeIndices, nextIndex } = entry;

          const attrs = attributesMapRef.current.get(note.keyName);
          if (!attrs) return;

          const opacity =
            track.noteOpacity != null
              ? Math.min(Math.max(track.noteOpacity / 100, 0), 1)
              : 0.8;
          const colorKey =
            track.noteColor && typeof track.noteColor === "object"
              ? JSON.stringify(track.noteColor)
              : track.noteColor ?? "";
          const cacheKey = `${colorKey}|${opacity}`;
          let colorData = colorCacheRef.current.get(cacheKey);
          if (!colorData) {
            colorData = buildColorAttributes(track.noteColor, opacity);
            colorCacheRef.current.set(cacheKey, colorData);
          }

          const index = freeIndices.pop() ?? entry.nextIndex++;
          if (index >= MAX_NOTES) {
            entry.nextIndex--;
            return;
          }
          noteIndexMap.set(note.id, index);
          noteTrackMapRef.current.set(note.id, note.keyName);

          const base3 = index * 3;
          const base2 = index * 2;
          const base4 = index * 4;

          attrs.noteInfoArray.set(
            [note.startTime, 0, track.position.dx],
            base3
          );
          attrs.noteSizeArray.set([track.width, track.position.dy], base2);
          attrs.noteColorArrayTop.set(colorData.top, base4);
          attrs.noteColorArrayBottom.set(colorData.bottom, base4);
          attrs.noteRadiusArray.set([track.borderRadius || 0], index);
          attrs.trackIndexArray.set([track.trackIndex], index);

          attrs.noteInfoAttr.needsUpdate = true;
          attrs.noteSizeAttr.needsUpdate = true;
          attrs.noteColorAttrTop.needsUpdate = true;
          attrs.noteColorAttrBottom.needsUpdate = true;
          attrs.noteRadiusAttr.needsUpdate = true;
          attrs.trackIndexAttr.needsUpdate = true;

          mesh.count = Math.max(mesh.count, index + 1);
        } else if (type === "finalize") {
          const trackKey = noteTrackMapRef.current.get(note.id);
          if (!trackKey) return;

          const entry = meshMapRef.current.get(trackKey);
          if (!entry) return;

          const index = entry.noteIndexMap.get(note.id);
          if (index === undefined) return;

          const attrs = attributesMapRef.current.get(trackKey);
          if (!attrs) return;

          const base3 = index * 3;
          // endTime만 업데이트
          attrs.noteInfoArray.set([note.endTime], base3 + 1);
          attrs.noteInfoAttr.needsUpdate = true;
        } else if (type === "cleanup") {
          // useNoteSystem에서 전달된 제거할 노트들 처리
          for (const noteId of note.ids) {
            const trackKey = noteTrackMapRef.current.get(noteId);
            if (!trackKey) continue;

            const entry = meshMapRef.current.get(trackKey);
            if (!entry) {
              noteTrackMapRef.current.delete(noteId);
              continue;
            }

            const index = entry.noteIndexMap.get(noteId);
            if (index !== undefined) {
              const attrs = attributesMapRef.current.get(trackKey);
              if (!attrs) continue;

              const base3 = index * 3;
              // 해당 인덱스를 0으로 만들어 셰이더에서 그리지 않도록 함
              attrs.noteInfoArray.set([0, 0], base3); // startTime, endTime을 0으로

              entry.noteIndexMap.delete(noteId);
              entry.freeIndices.push(index); // 인덱스 재사용
              noteTrackMapRef.current.delete(noteId);
            }
          }
          // cleanup은 여러 데이터를 변경하므로 needsUpdate를 한번만 설정
          for (const attrs of attributesMapRef.current.values()) {
            attrs.noteInfoAttr.needsUpdate = true;
          }

          // 활성 노트가 없으면 애니메이션 중지
          if (noteTrackMapRef.current.size === 0 && isAnimating.current) {
            animationScheduler.remove(animate);
            isAnimating.current = false;
            // 캔버스 클리어
            requestAnimationFrame(() => {
              if (!rendererRef.current) return;
              const { width, height } = rendererRef.current.getSize(
                new Vector2()
              );
              rendererRef.current.setScissor(0, 0, width, height);
              rendererRef.current.clear();
            });
          }
        }

        // needsUpdate 플래그는 각 이벤트 핸들러에서 개별적으로 설정됨
      };

      const unsubscribe = subscribe(handleNoteEvent);

      return () => {
        unsubscribe();
        if (isAnimating.current) {
          animationScheduler.remove(animate);
        }
        // 트랙 메쉬 정리
        for (const [, entry] of meshMapRef.current) {
          sceneRef.current?.remove(entry.mesh);
          try {
            entry.mesh.geometry.deleteAttribute?.("noteInfo");
            entry.mesh.geometry.deleteAttribute?.("noteSize");
            entry.mesh.geometry.deleteAttribute?.("noteColorTop");
            entry.mesh.geometry.deleteAttribute?.("noteColorBottom");
            entry.mesh.geometry.deleteAttribute?.("noteRadius");
            entry.mesh.geometry.deleteAttribute?.("trackIndex");
          } catch {}
          entry.mesh.dispose();
        }
        meshMapRef.current.clear();
        attributesMapRef.current.clear();

        geometryRef.current?.dispose();
        materialRef.current?.dispose();
        renderer.dispose();
      };
    }, []); // 의존성 배열 비워서 마운트 시 한 번만 실행

    // 2. 트랙 정보 업데이트
    useEffect(() => {
      const newTrackMap = new Map();
      tracks.forEach((track) => {
        newTrackMap.set(track.trackKey, track);
      });
      trackMapRef.current = newTrackMap;

      // 기존 트랙 메쉬의 renderOrder 갱신 (키 순서 변화 반영)
      tracks.forEach((track) => {
        const entry = meshMapRef.current.get(track.trackKey);
        if (entry) {
          entry.mesh.renderOrder = track.trackIndex ?? 0;
        }
      });
    }, [tracks]);

    // 3. 노트 설정(속도) 업데이트
    useEffect(() => {
      if (materialRef.current) {
        materialRef.current.uniforms.uFlowSpeed.value =
          noteSettings.speed || 180;
        materialRef.current.uniforms.uTrackHeight.value =
          noteSettings.trackHeight || 150;
        materialRef.current.uniforms.uReverse.value = noteSettings.reverse
          ? 1.0
          : 0.0;
        materialRef.current.uniforms.uShortThresholdMs.value =
          noteSettings.shortNoteThresholdMs || 120;
        materialRef.current.uniforms.uShortMinLengthPx.value =
          noteSettings.shortNoteMinLengthPx || 10;
        materialRef.current.uniforms.uDelayEnabled.value =
          noteSettings.delayedNoteEnabled ? 1.0 : 0.0;
        materialRef.current.uniforms.uFadePosition.value =
          fadePositionToUniform(noteSettings.fadePosition);
      }
    }, [
      noteSettings.speed,
      noteSettings.trackHeight,
      noteSettings.reverse,
      noteSettings.shortNoteThresholdMs,
      noteSettings.shortNoteMinLengthPx,
      noteSettings.delayedNoteEnabled,
      noteSettings.fadePosition,
    ]);

    // 4. 윈도우 리사이즈 처리
    useEffect(() => {
      const handleResize = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        if (rendererRef.current) {
          rendererRef.current.setSize(width, height);
          rendererRef.current.setPixelRatio(window.devicePixelRatio);
        }
        if (cameraRef.current) {
          cameraRef.current.left = 0;
          cameraRef.current.right = width;
          cameraRef.current.top = height;
          cameraRef.current.bottom = 0;
          cameraRef.current.updateProjectionMatrix();
        }
        if (materialRef.current) {
          materialRef.current.uniforms.uScreenHeight.value = height;
        }
      };

      window.addEventListener("resize", handleResize);
      handleResize();

      return () => {
        window.removeEventListener("resize", handleResize);
      };
    }, []);

    return (
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
    );
  }
);
