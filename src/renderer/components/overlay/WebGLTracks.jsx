import React, { memo, useEffect, useRef } from "react";
import * as THREE from "three";
import { animationScheduler } from "../../utils/animationScheduler";

const MAX_NOTES = 2048; // 씬에서 동시에 렌더링할 수 있는 최대 노트 수

// 버텍스 셰이더: 캔버스 로직과 동일한 (위▶아래 좌표계) 계산을 위해 DOM 기준(y 아래로 증가) 값을 받아
// 화면 변환 시 실제 WebGL 상(y 위로 증가)으로 변환 + 라운드 코너 처리를 위한 로컬 좌표 전달.
const vertexShader = `
  uniform float uTime;
  uniform float uFlowSpeed;
  uniform float uScreenHeight; // 전체 화면 높이 (캔버스 y -> WebGL y 변환용)
  uniform float uTrackHeight; // 트랙 높이 (150px)

  attribute vec3 noteInfo; // x: startTime, y: endTime, z: trackX (왼쪽 X px, DOM 기준)
  attribute vec2 noteSize; // x: width, y: trackBottomY (DOM 기준; 키 위치)
  attribute vec4 noteColor;
  attribute float noteRadius; // 픽셀 단위 라운드 반경

  varying vec4 vColor;
  varying vec2 vLocalPos;     // 노트 중심 기준 로컬 좌표(px)
  varying vec2 vHalfSize;     // (width/2, height/2)
  varying float vRadius;      // 라운드 반경(px)
  varying float vTrackTopY;   // 트랙 상단 Y 좌표 (DOM 기준)
  varying float vTrackBottomY; // 트랙 하단 Y 좌표 (DOM 기준)

  void main() {
    float startTime = noteInfo.x;
    float endTime = noteInfo.y;
    float trackX = noteInfo.z;
    float trackBottomY = noteSize.y; // DOM 기준(위=0 아래=+)
    float noteWidth = noteSize.x;

    bool isActive = endTime == 0.0;
    float rawNoteLength = 0.0;     // 원본 노트 길이
    float bottomCanvasY = 0.0;     // DOM 기준 바닥 y

    if (isActive) {
      rawNoteLength = max(0.0, (uTime - startTime) * uFlowSpeed / 1000.0);
      bottomCanvasY = trackBottomY; // 활성 중엔 바닥 고정
    } else {
      rawNoteLength = max(0.0, (endTime - startTime) * uFlowSpeed / 1000.0);
      float travel = (uTime - endTime) * uFlowSpeed / 1000.0; // 위로 이동 거리 (DOM 좌표에서 감소 방향)
      bottomCanvasY = trackBottomY - travel; // 위로(작아지는 방향) 이동
    }

    // 노트 길이를 트랙 높이로 제한 (원본 Track.jsx와 동일한 동작)
    float noteLength = min(rawNoteLength, uTrackHeight);
    
    // 원본 Track.jsx와 동일한 위치 계산: 트랙 컨테이너 내부에서 바닥부터 위로 자라남
    // yPosition = height - noteLength (원본 코드)
    // 트랙 상단 = trackBottomY - uTrackHeight, 트랙 바닥 = trackBottomY
    float noteTopY, noteBottomY;
    
    if (isActive) {
      // 활성 노트: 트랙 바닥부터 위로 자라남
      noteBottomY = trackBottomY;
      noteTopY = trackBottomY - noteLength;
    } else {
      // 비활성 노트: 위로 이동
      float travel = (uTime - endTime) * uFlowSpeed / 1000.0;
      noteBottomY = trackBottomY - travel;
      noteTopY = noteBottomY - noteLength;
    }
    
    // 트랙 영역을 벗어나는 경우 클리핑
    float trackTopY = trackBottomY - uTrackHeight;
    noteTopY = max(noteTopY, trackTopY);
    
    // 완전히 화면 위로 사라진 경우: 투명 처리
    if (noteBottomY < 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
      vColor = vec4(0.0);
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

    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);

    vColor = noteColor; // 색상
    vHalfSize = vec2(noteWidth, noteLength) * 0.5;
    vLocalPos = vec2(position.x * noteWidth, position.y * noteLength); // 중심 기준 -half~half
    vRadius = noteRadius;
    vTrackTopY = trackTopY;
    vTrackBottomY = trackBottomY;
  }
`;

// 프래그먼트 셰이더: 개별 노트 페이딩 제거, 상단 50px 전역 마스크 + 라운드 코너 SDF로 픽셀 discard
// gl_FragCoord.y 는 하단=0, 상단=screenHeight 이므로 distanceFromTop = uScreenHeight - gl_FragCoord.y
const fragmentShader = `
  uniform float uScreenHeight;
  varying vec4 vColor;
  varying vec2 vLocalPos;
  varying vec2 vHalfSize;
  varying float vRadius;
  varying float vTrackTopY;
  varying float vTrackBottomY;

  void main() {
    // 현재 픽셀의 DOM Y 좌표 계산
    float currentDOMY = uScreenHeight - gl_FragCoord.y;
    
    // 트랙 내에서의 상대적 위치 계산 (0.0 = 트랙 상단, 1.0 = 트랙 하단)
    float trackRelativeY = (currentDOMY - vTrackTopY) / (vTrackBottomY - vTrackTopY);
    
    float fadeZone = 50.0; // 트랙 상단에서 50px
    float trackHeight = vTrackBottomY - vTrackTopY;
    float fadeRatio = fadeZone / trackHeight; // 트랙 높이 대비 페이드 영역 비율
    
    float alpha = vColor.a;
    
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
    
    // 트랙 상단 페이드 영역 적용 (트랙 내 상대적 위치 기준)
    if (trackRelativeY < fadeRatio) {
      alpha *= clamp(trackRelativeY / fadeRatio, 0.0, 1.0);
    }

    gl_FragColor = vec4(vColor.rgb, alpha);
  }
`;

export const WebGLTracks = memo(
  ({ tracks, notesRef, subscribe, noteSettings }) => {
    const canvasRef = useRef();
    const rendererRef = useRef();
    const sceneRef = useRef();
    const cameraRef = useRef();
    const meshRef = useRef();
    const materialRef = useRef();
    const trackMapRef = useRef(new Map());
    const attributesRef = useRef(null); // 속성 캐싱용
    const colorCacheRef = useRef(new Map()); // 색상 변환 캐싱

    // 1. WebGL 씬 초기 설정 (단 한번만 실행)
    useEffect(() => {
      const canvas = canvasRef.current;
      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      rendererRef.current = renderer;

      const scene = new THREE.Scene();
      sceneRef.current = scene;

      const camera = new THREE.OrthographicCamera(
        0,
        window.innerWidth,
        window.innerHeight,
        0,
        1,
        1000
      );
      camera.position.z = 5;
      cameraRef.current = camera;

      const geometry = new THREE.PlaneGeometry(1, 1).toNonIndexed();

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uFlowSpeed: { value: noteSettings.speed || 180 },
          uScreenHeight: { value: window.innerHeight },
          uTrackHeight: { value: 150 }, // 트랙 높이 150px로 고정
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        blending: THREE.NormalBlending,
      });
      materialRef.current = material;

      const mesh = new THREE.InstancedMesh(geometry, material, MAX_NOTES);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // 매 프레임 업데이트 명시
      scene.add(mesh);
      meshRef.current = mesh;

      // 속성 미리 생성 및 캐싱 (성능 최적화)
      const noteInfoArray = new Float32Array(MAX_NOTES * 3);
      const noteSizeArray = new Float32Array(MAX_NOTES * 2);
      const noteColorArray = new Float32Array(MAX_NOTES * 4);
      const noteRadiusArray = new Float32Array(MAX_NOTES);

      const noteInfoAttr = new THREE.InstancedBufferAttribute(noteInfoArray, 3);
      const noteSizeAttr = new THREE.InstancedBufferAttribute(noteSizeArray, 2);
      const noteColorAttr = new THREE.InstancedBufferAttribute(
        noteColorArray,
        4
      );

      mesh.geometry.setAttribute("noteInfo", noteInfoAttr);
      mesh.geometry.setAttribute("noteSize", noteSizeAttr);
      mesh.geometry.setAttribute("noteColor", noteColorAttr);
      const noteRadiusAttr = new THREE.InstancedBufferAttribute(
        noteRadiusArray,
        1
      );
      mesh.geometry.setAttribute("noteRadius", noteRadiusAttr);

      attributesRef.current = {
        noteInfoArray,
        noteSizeArray,
        noteColorArray,
        noteInfoAttr,
        noteSizeAttr,
        noteColorAttr,
        noteRadiusArray,
        noteRadiusAttr,
      };

      // 애니메이션 루프 등록 (가시 노트만 선별하여 CPU 안정화)
      const draw = (currentTime) => {
        if (
          !rendererRef.current ||
          !sceneRef.current ||
          !cameraRef.current ||
          !meshRef.current ||
          !materialRef.current ||
          !attributesRef.current
        )
          return;

        materialRef.current.uniforms.uTime.value = currentTime;
        const screenHeight = window.innerHeight; // 캔버스 전체 높이
        const maxInstances = MAX_NOTES;
        let writeIndex = 0; // 실제 가시 노트 인덱스

        const {
          noteInfoArray,
          noteSizeArray,
          noteColorArray,
          noteRadiusArray,
          noteInfoAttr,
          noteSizeAttr,
          noteColorAttr,
          noteRadiusAttr,
        } = attributesRef.current;

        // 트랙별 순회 (가시성 판단 & 조기 컬링)
        trackMapRef.current.forEach((track, trackKey) => {
          const trackNotes = notesRef.current[trackKey];
          if (!trackNotes || trackNotes.length === 0) return;
          const baseX = track.position.dx;
          const width = track.width;
          const trackBottom = track.position.dy; // DOM 기준 키 위치

          // 색상 캐싱 (Track.jsx와 동일한 방식으로 헥스 색상 파싱)
          let colorData = colorCacheRef.current.get(track.noteColor);
          if (!colorData) {
            const color = track.noteColor;
            if (color.startsWith("#")) {
              const r = parseInt(color.slice(1, 3), 16) / 255;
              const g = parseInt(color.slice(3, 5), 16) / 255;
              const b = parseInt(color.slice(5, 7), 16) / 255;
              colorData = { r, g, b };
            } else {
              // 기본값 (흰색)
              colorData = { r: 1, g: 1, b: 1 };
            }
            colorCacheRef.current.set(track.noteColor, colorData);
          }

          for (let i = 0; i < trackNotes.length; i++) {
            if (writeIndex >= maxInstances) break; // 용량 초과
            const note = trackNotes[i];
            const start = note.startTime;
            const end = note.endTime || 0;
            const isActive = note.isActive;

            // CPU 컬링을 위한 간단한 위치 계산 (버텍스 셰이더와 동일 로직 축약)
            let noteLength;
            let bottomY;
            if (isActive) {
              noteLength =
                ((currentTime - start) *
                  materialRef.current.uniforms.uFlowSpeed.value) /
                1000.0;
              if (noteLength < 0) continue;
              bottomY = trackBottom;
            } else {
              noteLength =
                ((end - start) *
                  materialRef.current.uniforms.uFlowSpeed.value) /
                1000.0;
              if (noteLength < 0) continue;
              const travel =
                ((currentTime - end) *
                  materialRef.current.uniforms.uFlowSpeed.value) /
                1000.0;
              bottomY = trackBottom - travel;
            }

            // 화면 상단 완전 이탈 (노트 상단이 0보다 위) => skip
            if (bottomY < -noteLength) continue;
            // 화면 하단 지나친 (아직 생성 초기?) case 는 없음 (bottomY>=0 이면 그릴 수 있음)
            if (bottomY > screenHeight + noteLength) continue; // 비정상적으로 아래 (안전)

            const base3 = writeIndex * 3;
            const base2 = writeIndex * 2;
            const base4 = writeIndex * 4;
            noteInfoArray[base3] = start;
            noteInfoArray[base3 + 1] = end; // 0이면 active
            noteInfoArray[base3 + 2] = baseX;
            noteSizeArray[base2] = width;
            noteSizeArray[base2 + 1] = trackBottom;
            noteColorArray[base4] = colorData.r;
            noteColorArray[base4 + 1] = colorData.g;
            noteColorArray[base4 + 2] = colorData.b;
            noteColorArray[base4 + 3] = track.noteOpacity / 100;
            noteRadiusArray[writeIndex] = track.borderRadius || 0;
            writeIndex++;
          }
        });

        if (writeIndex === 0) {
          meshRef.current.count = 0;
          rendererRef.current.render(sceneRef.current, cameraRef.current);
          // 다음 루프에서 스케줄러 해제 (안정성 위해 즉시 remove 하지 않음)
          return;
        }

        // needsUpdate 플래그 (사용된 앞부분만 GPU에서 참조)
        noteInfoAttr.needsUpdate = true;
        noteSizeAttr.needsUpdate = true;
        noteColorAttr.needsUpdate = true;
        noteRadiusAttr.needsUpdate = true;

        meshRef.current.count = writeIndex;
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      };

      const handleNotesChange = () => {
        const noteCount = Object.values(notesRef.current).flat().length;
        if (noteCount > 0) {
          animationScheduler.add(draw);
        } else {
          animationScheduler.remove(draw);
          // 노트가 없을 때 한번 더 그려서 캔버스 클리어
          requestAnimationFrame(() => {
            const { width, height } = rendererRef.current.getSize(
              new THREE.Vector2()
            );
            rendererRef.current.setScissor(0, 0, width, height);
            rendererRef.current.clear();
          });
        }
      };

      const unsubscribe = subscribe(handleNotesChange);

      return () => {
        unsubscribe();
        animationScheduler.remove(draw);
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
    }, [tracks]);

    // 3. 노트 설정(속도) 업데이트
    useEffect(() => {
      if (materialRef.current) {
        materialRef.current.uniforms.uFlowSpeed.value =
          noteSettings.speed || 180;
      }
    }, [noteSettings.speed]);

    // 4. 윈도우 리사이즈 처리
    useEffect(() => {
      const handleResize = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        if (rendererRef.current) {
          rendererRef.current.setSize(width, height);
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
      return () => window.removeEventListener("resize", handleResize);
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
