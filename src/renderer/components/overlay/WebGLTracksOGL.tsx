import React, { useEffect, useRef } from 'react';
import { Renderer, Camera, Transform, Program, Geometry, Mesh } from 'ogl';
import type { OGLRenderingContext } from 'ogl';
import { animationScheduler } from '@utils/animation/animationScheduler';
import { DEFAULT_NOTE_SETTINGS } from '@constants/overlayDefaults';
import { resolvedFadeValues } from '@src/types/settings/noteSettings';
import { trackRectFromOrigin } from '@utils/layout/trackGeometry';
import type { NoteSettings } from '@src/types/settings/noteSettings';
import {
  MAX_NOTES,
  resolvedGlowSize,
  type TrackLayoutInput,
} from '@stores/signals/noteBuffer';
import { isMac } from '@utils/core/platform';

const vertexShader = `
  attribute vec3 position;
  attribute vec3 noteInfo; // x: startTime, y: endTime, z: origin.x (히트라인 c=0 코너)
  attribute vec2 noteSize; // x: 교차축 크기, y: origin.y
  attribute vec2 noteDir;  // 진행 방향 벡터 d (캔버스 좌표, y 아래 양수)
  attribute vec4 noteColorTop;
  attribute vec4 noteColorBottom;
  attribute float noteRadius;
  attribute vec3 noteGlow; // x: glow size, y: glow opacity far (0-1), z: glow opacity near (0-1)
  attribute vec3 noteGlowColorTop;
  attribute vec3 noteGlowColorBottom;
  attribute vec4 noteBorder; // x: width, yzw: RGB color
  attribute float noteBorderOpacity; // 0-1, 노트 배경 투명도와 독립
  attribute float trackIndex;

  uniform mat4 projectionMatrix;
  uniform mat4 modelViewMatrix;
  uniform float uTime;
  uniform float uFlowSpeed;
  uniform float uScreenHeight;
  uniform float uTrackHeight;
  uniform float uReverse;

  varying vec4 vColorTop;
  varying vec4 vColorBottom;
  varying vec2 vLocalPos;
  varying vec2 vHalfSize;
  varying float vRadius;
  varying float vGlowSize;
  varying vec2 vGlowOpacity;
  varying vec3 vGlowColorTop;
  varying vec3 vGlowColorBottom;
  varying vec4 vBorder; // x: width, yzw: RGB color
  varying float vBorderOpacity;
  // 흐름 비율 (1 - s/H). 글로우 확장 정점의 raw 값을 보간하고 fragment에서 clamp
  varying float vFlowRatioRaw;

  void main() {
    float startTime = noteInfo.x;
    float endTime = noteInfo.y;
    vec2 origin = vec2(noteInfo.z, noteSize.y);
    float crossSize = noteSize.x;

    if (startTime == 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
      vColorTop = vec4(0.0);
      vColorBottom = vec4(0.0);
      return;
    }

    bool isActive = endTime == 0.0;
    float rawNoteLength = 0.0;
    float glowSize = max(noteGlow.x, 0.0);
    float glowOpacityFar = clamp(noteGlow.y, 0.0, 1.0);
    float glowOpacityNear = clamp(noteGlow.z, 0.0, 1.0);

    if (isActive) {
      rawNoteLength = max(0.0, (uTime - startTime) * uFlowSpeed / 1000.0);
    } else {
      rawNoteLength = max(0.0, (endTime - startTime) * uFlowSpeed / 1000.0);
    }

    // s = 히트라인으로부터 진행 방향 거리. 활성 [0, len], 완료 [travel, travel+len]
    float len = min(rawNoteLength, uTrackHeight);
    float rawLo;
    float rawHi;
    if (isActive) {
      rawLo = 0.0;
      rawHi = len;
    } else {
      float travel = (uTime - endTime) * uFlowSpeed / 1000.0;
      rawLo = travel;
      rawHi = travel + len;
    }

    // 리버스 = s공간 미러 (방향과 독립)
    if (uReverse >= 0.5) {
      float mirroredLo = uTrackHeight - rawHi;
      rawHi = uTrackHeight - rawLo;
      rawLo = mirroredLo;
    }

    // 컬링은 raw 구간으로 선판정 (클램프 후 판정하면 트랙을 벗어난 완료
    // 노트가 0길이로 접혀 잔류). 키쪽 경계는 strict less로 스폰 프레임
    // 길이 0 글로우 퍼프를 보존
    if (rawLo >= uTrackHeight || rawHi < 0.0 || rawHi < rawLo) {
      gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
      vColorTop = vec4(0.0);
      vColorBottom = vec4(0.0);
      return;
    }

    float sLo = clamp(rawLo, 0.0, uTrackHeight);
    float sHi = clamp(rawHi, 0.0, uTrackHeight);
    float noteLength = sHi - sLo;

    vec2 dir = noteDir;
    vec2 perp = vec2(-dir.y, dir.x);

    float centerS = (sLo + sHi) / 2.0;
    vec2 centerCanvas = origin + dir * centerS + perp * (crossSize / 2.0);
    // 캔버스(y 아래) → 월드(y 위) 변환: y만 뒤집기
    vec2 centerWorld = vec2(centerCanvas.x, uScreenHeight - centerCanvas.y);
    vec2 dirWorld = vec2(dir.x, -dir.y);
    vec2 perpWorld = vec2(perp.x, -perp.y);

    float expandedWidth = crossSize + glowSize * 2.0;
    float expandedLength = noteLength + glowSize * 2.0;

    // 쿼드 로컬: position.x = 교차축, position.y = 진행축
    vec2 planar = centerWorld
      + dirWorld * (position.y * expandedLength)
      + perpWorld * (position.x * expandedWidth);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(planar, 0.0, 1.0);

    vColorTop = noteColorTop;
    vColorBottom = noteColorBottom;
    vHalfSize = vec2(crossSize, noteLength) * 0.5;
    vLocalPos = vec2(position.x * expandedWidth, position.y * expandedLength);
    vRadius = noteRadius;
    vGlowSize = glowSize;
    vGlowOpacity = vec2(glowOpacityFar, glowOpacityNear);
    vGlowColorTop = noteGlowColorTop;
    vGlowColorBottom = noteGlowColorBottom;
    vBorder = noteBorder;
    vBorderOpacity = noteBorderOpacity;

    // 확장 정점의 raw s로 흐름 비율 계산 (fragment에서 clamp)
    float sVertex = centerS + position.y * expandedLength;
    vFlowRatioRaw = 1.0 - sVertex / max(uTrackHeight, 0.0001);
  }
`;

const fragmentShader = `
  precision highp float;

  uniform float uTrackHeight;
  uniform float uFadeFarPx;
  uniform float uFadeNearPx;

  varying vec4 vColorTop;
  varying vec4 vColorBottom;
  varying vec2 vLocalPos;
  varying vec2 vHalfSize;
  varying float vRadius;
  varying float vGlowSize;
  varying vec2 vGlowOpacity;
  varying vec3 vGlowColorTop;
  varying vec3 vGlowColorBottom;
  varying vec4 vBorder; // x: width, yzw: RGB color
  varying float vBorderOpacity;
  varying float vFlowRatioRaw;

  void main() {
    // 흐름 비율: 0 = 먼쪽 끝, 1 = 키(히트라인)쪽. 버텍스 raw 보간 후 여기서 clamp
    float trackHeight = max(uTrackHeight, 0.0001);
    float gradientRatio = clamp(vFlowRatioRaw, 0.0, 1.0);
    float trackRelativeY = gradientRatio;

    vec4 baseColor = mix(vColorTop, vColorBottom, gradientRatio);
    vec3 glowColor = mix(vGlowColorTop, vGlowColorBottom, gradientRatio);
    float glowOpacity = mix(vGlowOpacity.x, vGlowOpacity.y, gradientRatio);

    float r = clamp(vRadius, 0.0, min(vHalfSize.x, vHalfSize.y));
    vec2 q = abs(vLocalPos) - (vHalfSize - vec2(r));
    float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    float aa = 1.0;

    // 테두리 디코딩: width에 side mode 인코딩됨 (0~20=all, 100~120=vertical, 200~220=horizontal)
    float encodedWidth = vBorder.x;
    vec3 borderColor = vBorder.yzw;
    float sideMode = 0.0;
    float bw = encodedWidth;
    if (encodedWidth >= 150.0) {
      sideMode = 2.0;
      bw = encodedWidth - 200.0;
    } else if (encodedWidth >= 50.0) {
      sideMode = 1.0;
      bw = encodedWidth - 100.0;
    }

    float outerMask = clamp(1.0 - dist / aa, 0.0, 1.0);
    float innerMask;
    if (bw > 0.0) {
      if (sideMode == 0.0) {
        // 전체: 기존 SDF 기반 축소
        float innerDist = dist + bw;
        innerMask = clamp(1.0 - innerDist / aa, 0.0, 1.0);
      } else {
        // 축별 테두리: 선택된 축의 edge distance 기반
        float edgeDist;
        if (sideMode == 1.0) {
          // 수직 (좌우 테두리)
          edgeDist = vHalfSize.x - abs(vLocalPos.x);
        } else {
          // 수평 (상하 테두리)
          edgeDist = vHalfSize.y - abs(vLocalPos.y);
        }
        float borderZone = clamp((bw - edgeDist) / aa, 0.0, 1.0);
        innerMask = outerMask * (1.0 - borderZone);
      }
    } else {
      innerMask = outerMask;
    }
    float borderMask = outerMask - innerMask;
    float bodyAlpha = baseColor.a * innerMask;
    // 테두리 투명도는 노트 배경(baseColor.a)과 독립
    float borderAlpha = vBorderOpacity * borderMask;

    float glowAlpha = 0.0;
    if (vGlowSize > 0.0) {
      float outside = max(dist, 0.0);
      float range = max(vGlowSize, 0.0001);
      float glowFalloff = clamp(1.0 - outside / range, 0.0, 1.0);
      glowAlpha = baseColor.a * glowOpacity * pow(glowFalloff, 2.0);
    }

    float fadeMask = 1.0;
    if (uFadeFarPx > 0.0) {
      float farFadeRatio = uFadeFarPx / trackHeight;
      fadeMask = min(fadeMask, clamp(trackRelativeY / farFadeRatio, 0.0, 1.0));
    }
    if (uFadeNearPx > 0.0) {
      float nearFadeRatio = uFadeNearPx / trackHeight;
      fadeMask = min(fadeMask, clamp((1.0 - trackRelativeY) / nearFadeRatio, 0.0, 1.0));
    }
    bodyAlpha *= fadeMask;
    borderAlpha *= fadeMask;
    glowAlpha *= fadeMask;

    float outAlpha = clamp(bodyAlpha + borderAlpha + glowAlpha, 0.0, 1.0);
    vec3 borderContrib = borderAlpha > 0.0 ? borderColor * borderAlpha : vec3(0.0);
    vec3 outColor = baseColor.rgb * bodyAlpha + borderContrib + glowColor * glowAlpha;
    gl_FragColor = vec4(outColor, outAlpha);
  }
`;

const buildPlaneGeometry = (gl: OGLRenderingContext): Geometry =>
  new Geometry(gl, {
    position: {
      size: 3,
      data: new Float32Array([
        -0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0,
        -0.5, 0.5, 0,
      ]),
    },
  });

const INSTANCED_ATTRIBUTE_KEYS: readonly string[] = Object.freeze([
  'noteInfo',
  'noteSize',
  'noteColorTop',
  'noteColorBottom',
  'noteRadius',
  'noteGlow',
  'noteGlowColorTop',
  'noteGlowColorBottom',
  'noteBorder',
  'noteBorderOpacity',
  'trackIndex',
  'noteDir',
]);

const FINALIZE_ATTRIBUTE_KEYS: readonly string[] = Object.freeze(['noteInfo']);

const markAttributesDirty = (
  geometry: Geometry | null,
  keys?: Iterable<string> | null,
): void => {
  if (!geometry) return;
  const attributes = geometry.attributes;
  if (!attributes) return;
  const targetKeys = keys ?? Object.keys(attributes);
  for (const key of targetKeys) {
    const attr = attributes[key];
    if (attr) {
      attr.needsUpdate = true;
    }
  }
};

const markInstancedAttributesDirty = (
  geometry: Geometry | null,
  activeCount: number,
  keys: Iterable<string> = INSTANCED_ATTRIBUTE_KEYS,
): void => {
  if (!geometry) return;
  geometry.instancedCount = Math.min(activeCount, MAX_NOTES);
  markAttributesDirty(geometry, keys);
};

// OGL은 needsUpdate 시 gl.bufferSubData(0, attr.data)를 호출하므로
// attr.data를 activeCount 범위 subarray로 교체하면 업로드 바이트를 줄일 수 있음
const updateAttributeSubranges = (
  geometry: Geometry,
  noteBuffer: NoteBuffer,
  activeCount: number,
  keys: Iterable<string>,
): void => {
  if (activeCount <= 0) return;
  const attrs = geometry.attributes;
  for (const key of keys) {
    const attr = attrs[key];
    const source = (noteBuffer as unknown as Record<string, unknown>)[key];
    if (attr && source instanceof Float32Array) {
      attr.data = source.subarray(0, activeCount * attr.size);
    }
  }
};

interface PendingUpdate {
  dirtyKeys: Set<string>;
  dirtySinceFrame: boolean;
  instancedCount: number | null;
}

const queueAttributeUpload = (
  pendingUpdate: PendingUpdate | null,
  keys: Iterable<string>,
  activeCount: number | undefined = undefined,
): void => {
  if (!pendingUpdate) return;
  if (activeCount !== undefined) {
    pendingUpdate.instancedCount = Math.min(activeCount, MAX_NOTES);
  }
  (keys as string[]).forEach((key: string) => pendingUpdate.dirtyKeys.add(key));
  pendingUpdate.dirtySinceFrame = true;
};

const normalizeFrameLimit = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : 0;
};

const FRAME_PACING_EPSILON_MS = 0.3;
const MAX_DRIFT_FRAMES = 8;
const MACOS_DPR_CAP = 1;

const resolveDpr = (): number => {
  const rawDpr = window.devicePixelRatio || 1;
  return isMac() ? Math.min(rawDpr, MACOS_DPR_CAP) : rawDpr;
};

// 캔버스 crop: 노트가 실제로 그려질 수 있는 트랙 union 영역 (DOM 좌표)
interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// crop 적용 상태 — windowH/dpr이 바뀌면 rect가 같아도 재적용 필요
interface AppliedCrop {
  rect: CropRect;
  windowH: number;
  dpr: number;
}

const CROP_AA_PAD = 2;

const computeTrackBounds = (
  tracks: TrackLayoutInput[],
  trackHeight: number,
): CropRect | null => {
  if (tracks.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const track of tracks) {
    const pad = resolvedGlowSize(track) + CROP_AA_PAD;
    // 셰이더는 uTrackHeight 기준으로 노트를 클램프하므로 per-track height 대신 설정값 사용
    const rect = trackRectFromOrigin(
      { x: track.position.dx, y: track.position.dy },
      track.direction ?? 'up',
      trackHeight,
      track.width,
    );
    minX = Math.min(minX, rect.minX - pad);
    maxX = Math.max(maxX, rect.maxX + pad);
    minY = Math.min(minY, rect.minY - pad);
    maxY = Math.max(maxY, rect.maxY + pad);
  }
  // 뷰포트 교집합 + floor/ceil 반올림 (1px 클리핑·떨림 방지)
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  const right = Math.min(window.innerWidth, Math.ceil(maxX));
  const bottom = Math.min(window.innerHeight, Math.ceil(maxY));
  if (right <= x || bottom <= y) return null;
  return { x, y, w: right - x, h: bottom - y };
};

const unionCropRect = (a: CropRect, b: CropRect): CropRect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
};

const cropRectEquals = (a: CropRect | null, b: CropRect | null): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
};

interface FrameClock {
  nextFrameTime: number;
  stableTime: number;
}

const resetFrameClock = (frameClock: FrameClock | null): void => {
  if (!frameClock) return;
  frameClock.nextFrameTime = 0;
  frameClock.stableTime = 0;
};

interface NoteEvent {
  type: 'add' | 'finalize' | 'cleanup' | 'clear';
  activeCount?: number;
  version?: number;
}

interface NoteBuffer {
  version: number;
  activeCount: number;
  timeEpoch: number;
  maybeRebaseEpoch(nowMs: number): boolean;
  noteInfo: Float32Array;
  noteSize: Float32Array;
  noteColorTop: Float32Array;
  noteColorBottom: Float32Array;
  noteRadius: Float32Array;
  noteGlow: Float32Array;
  noteGlowColorTop: Float32Array;
  noteGlowColorBottom: Float32Array;
  noteBorder: Float32Array;
  noteBorderOpacity: Float32Array;
  trackIndex: Float32Array;
  noteDir: Float32Array;
}

interface WebGLTracksOGLProps {
  tracks: TrackLayoutInput[];
  notesRef: unknown;
  subscribe: (callback: (event: NoteEvent) => void) => () => void;
  noteSettings: NoteSettings;
  laboratoryEnabled?: boolean;
  noteBuffer: NoteBuffer | null;
}

export function WebGLTracksOGL({
  tracks,
  notesRef: _notesRef,
  subscribe,
  noteSettings,
  laboratoryEnabled: _laboratoryEnabled,
  noteBuffer,
}: WebGLTracksOGLProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const sceneRef = useRef<Transform | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const programRef = useRef<Program | null>(null);
  const geometryRef = useRef<Geometry | null>(null);
  const isAnimating = useRef<boolean>(false);
  const lastVersionRef = useRef<number>(noteBuffer?.version ?? 0);
  const pendingUpdateRef = useRef<PendingUpdate>({
    dirtyKeys: new Set<string>(),
    dirtySinceFrame: false,
    instancedCount: null,
  });
  const frameLimitRef = useRef<number>(
    normalizeFrameLimit(noteSettings?.frameLimit),
  );
  const frameClockRef = useRef<FrameClock>({ nextFrameTime: 0, stableTime: 0 });
  const cropAppliedRef = useRef<AppliedCrop | null>(null);
  const refreshCropRef = useRef<() => void>(() => {});
  const subscribeRef = useRef(subscribe);
  useEffect(() => {
    subscribeRef.current = subscribe;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !noteBuffer) return;
    const initialDpr = resolveDpr();

    const renderer = new Renderer({
      canvas,
      alpha: true,
      antialias: false,
      dpr: initialDpr,
      premultipliedAlpha: true,
      // 2D 노트는 depthTest/depthWrite 모두 안 씀 — depth attachment와 매 프레임 depth clear 제거
      depth: false,
    });
    rendererRef.current = renderer;

    const { gl } = renderer;
    gl.clearColor(0, 0, 0, 0);

    const scene = new Transform();
    sceneRef.current = scene;

    const camera = new Camera(gl, {
      left: 0,
      right: window.innerWidth,
      top: window.innerHeight,
      bottom: 0,
      near: 1,
      far: 1000,
    });
    // 실제 직교 경계는 crop 이펙트의 applyCrop이 네 경계값을 모두 명시해 설정
    camera.position.z = 5;
    cameraRef.current = camera;

    const geometry = buildPlaneGeometry(gl);
    geometry.addAttribute('noteInfo', {
      instanced: 1,
      size: 3,
      data: noteBuffer.noteInfo,
      usage: gl.DYNAMIC_DRAW,
    });
    geometry.addAttribute('noteSize', {
      instanced: 1,
      size: 2,
      data: noteBuffer.noteSize,
      usage: gl.DYNAMIC_DRAW,
    });
    geometry.addAttribute('noteColorTop', {
      instanced: 1,
      size: 4,
      data: noteBuffer.noteColorTop,
      usage: gl.DYNAMIC_DRAW,
    });
    geometry.addAttribute('noteColorBottom', {
      instanced: 1,
      size: 4,
      data: noteBuffer.noteColorBottom,
      usage: gl.DYNAMIC_DRAW,
    });
    geometry.addAttribute('noteRadius', {
      instanced: 1,
      size: 1,
      data: noteBuffer.noteRadius,
      usage: gl.DYNAMIC_DRAW,
    });
    geometry.addAttribute('noteGlow', {
      instanced: 1,
      size: 3,
      data: noteBuffer.noteGlow,
      usage: gl.DYNAMIC_DRAW,
    });
    geometry.addAttribute('noteGlowColorTop', {
      instanced: 1,
      size: 3,
      data: noteBuffer.noteGlowColorTop,
      usage: gl.DYNAMIC_DRAW,
    });
    geometry.addAttribute('noteGlowColorBottom', {
      instanced: 1,
      size: 3,
      data: noteBuffer.noteGlowColorBottom,
      usage: gl.DYNAMIC_DRAW,
    });
    geometry.addAttribute('noteBorder', {
      instanced: 1,
      size: 4,
      data: noteBuffer.noteBorder,
      usage: gl.DYNAMIC_DRAW,
    });
    geometry.addAttribute('noteBorderOpacity', {
      instanced: 1,
      size: 1,
      data: noteBuffer.noteBorderOpacity,
      usage: gl.DYNAMIC_DRAW,
    });
    geometry.addAttribute('trackIndex', {
      instanced: 1,
      size: 1,
      data: noteBuffer.trackIndex,
      usage: gl.DYNAMIC_DRAW,
    });
    geometry.addAttribute('noteDir', {
      instanced: 1,
      size: 2,
      data: noteBuffer.noteDir,
      usage: gl.DYNAMIC_DRAW,
    });
    markInstancedAttributesDirty(geometry, noteBuffer.activeCount);
    geometryRef.current = geometry;

    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uFlowSpeed: {
          value: noteSettings.speed || DEFAULT_NOTE_SETTINGS.speed,
        },
        uScreenHeight: { value: window.innerHeight },
        uTrackHeight: {
          value: noteSettings.trackHeight || DEFAULT_NOTE_SETTINGS.trackHeight,
        },
        uReverse: { value: noteSettings.reverse ? 1.0 : 0.0 },
        uFadeFarPx: { value: resolvedFadeValues(noteSettings).topPx },
        uFadeNearPx: { value: resolvedFadeValues(noteSettings).bottomPx },
      },
    });
    programRef.current = program;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.blendEquation(gl.FUNC_ADD);

    const mesh = new Mesh(gl, { geometry, program });
    // 노트 위치는 셰이더가 전적으로 결정 — 원점 쿼드 바운즈 기반 CPU 컬링은
    // crop 카메라(원점 미포함)에서 메시 전체를 오컬링하므로 비활성화
    mesh.frustumCulled = false;
    mesh.setParent(scene);

    const animate = (currentTime: number): void => {
      if (
        !rendererRef.current ||
        !sceneRef.current ||
        !cameraRef.current ||
        !programRef.current
      ) {
        return;
      }

      if (noteBuffer.activeCount === 0) {
        if (isAnimating.current) {
          animationScheduler.remove(animate);
          isAnimating.current = false;
        }
        return;
      }

      const frameLimit = frameLimitRef.current;
      let renderTime = currentTime;
      if (frameLimit > 0) {
        const interval = 1000 / frameLimit;
        const frameClock = frameClockRef.current;

        if (frameClock.nextFrameTime <= 0) {
          frameClock.stableTime = currentTime;
          frameClock.nextFrameTime = currentTime + interval;
        } else {
          if (
            currentTime + FRAME_PACING_EPSILON_MS <
            frameClock.nextFrameTime
          ) {
            return;
          }

          const drift = currentTime - frameClock.nextFrameTime;
          if (drift > interval * MAX_DRIFT_FRAMES) {
            frameClock.stableTime = currentTime;
            frameClock.nextFrameTime = currentTime + interval;
          } else {
            const stepCount = Math.floor(Math.max(0, drift) / interval) + 1;
            frameClock.stableTime += interval * stepCount;
            frameClock.nextFrameTime += interval * stepCount;
          }
          renderTime = frameClock.stableTime;
        }
      } else {
        resetFrameClock(frameClockRef.current);
      }

      // Float32 정밀도 유지 - 장시간 실행 시 epoch 이동, noteInfo 전체 재업로드 예약
      if (noteBuffer.maybeRebaseEpoch(renderTime)) {
        queueAttributeUpload(
          pendingUpdateRef.current,
          FINALIZE_ATTRIBUTE_KEYS,
          noteBuffer.activeCount,
        );
      }

      // 프레임 시작 시 배치 업데이트 적용
      if (pendingUpdateRef.current.dirtySinceFrame) {
        const geometryTarget = geometryRef.current;
        if (geometryTarget) {
          const uploadCount =
            pendingUpdateRef.current.instancedCount ?? noteBuffer.activeCount;
          if (pendingUpdateRef.current.instancedCount != null) {
            geometryTarget.instancedCount =
              pendingUpdateRef.current.instancedCount;
          }
          if (pendingUpdateRef.current.dirtyKeys.size > 0) {
            // 활성 범위만 GPU 업로드되도록 attr.data를 subarray로 교체
            updateAttributeSubranges(
              geometryTarget,
              noteBuffer,
              uploadCount,
              pendingUpdateRef.current.dirtyKeys,
            );
            markAttributesDirty(
              geometryTarget,
              pendingUpdateRef.current.dirtyKeys,
            );
          }
        }
        pendingUpdateRef.current.dirtyKeys.clear();
        pendingUpdateRef.current.dirtySinceFrame = false;
        pendingUpdateRef.current.instancedCount = null;
      }

      // uTime도 epoch 상대값 - noteInfo와 같은 기준이어야 길이·이동 계산이 성립
      programRef.current.uniforms.uTime.value =
        renderTime - noteBuffer.timeEpoch;
      rendererRef.current.render({
        scene: sceneRef.current,
        camera: cameraRef.current,
      });
    };

    const handleNoteEvent = (event: NoteEvent): void => {
      if (!event) return;
      const geometryTarget = geometryRef.current;
      if (!geometryTarget) return;

      if (event.activeCount !== undefined) {
        geometryTarget.instancedCount = Math.min(event.activeCount, MAX_NOTES);
      }

      // Version 체크는 clear 이벤트만 적용 (전체 리셋 시)
      if (event.type === 'clear') {
        lastVersionRef.current = event.version ?? lastVersionRef.current;
      }

      switch (event.type) {
        case 'add':
          queueAttributeUpload(
            pendingUpdateRef.current,
            INSTANCED_ATTRIBUTE_KEYS,
            event.activeCount,
          );
          if (!isAnimating.current && noteBuffer.activeCount > 0) {
            resetFrameClock(frameClockRef.current);
            animationScheduler.add(animate);
            isAnimating.current = true;
          }
          break;
        case 'finalize':
          // 즉시 GPU 업로드하지 않고 다음 프레임에 배치 처리
          queueAttributeUpload(
            pendingUpdateRef.current,
            FINALIZE_ATTRIBUTE_KEYS,
            event.activeCount,
          );
          if (!isAnimating.current && noteBuffer.activeCount > 0) {
            resetFrameClock(frameClockRef.current);
            animationScheduler.add(animate);
            isAnimating.current = true;
          }
          break;
        case 'cleanup':
        case 'clear':
          // cleanup/clear는 즉시 처리 (빈도가 낮음)
          if (noteBuffer.activeCount > 0) {
            updateAttributeSubranges(
              geometryTarget,
              noteBuffer,
              noteBuffer.activeCount,
              INSTANCED_ATTRIBUTE_KEYS,
            );
          }
          markInstancedAttributesDirty(geometryTarget, noteBuffer.activeCount);
          pendingUpdateRef.current.dirtyKeys.clear();
          pendingUpdateRef.current.dirtySinceFrame = false;
          pendingUpdateRef.current.instancedCount = null;
          if (noteBuffer.activeCount === 0 && isAnimating.current) {
            animationScheduler.remove(animate);
            isAnimating.current = false;
            resetFrameClock(frameClockRef.current);
            requestAnimationFrame(() => {
              if (!rendererRef.current) return;
              const { gl: context } = rendererRef.current;
              context.clear(context.COLOR_BUFFER_BIT);
            });
          }
          if (noteBuffer.activeCount === 0) {
            // 버퍼가 비면 유예했던 crop 축소를 반영
            refreshCropRef.current();
          }
          break;
        default:
          break;
      }
    };

    const unsubscribe = subscribeRef.current(handleNoteEvent);

    // 뷰포트/DPR 변경 시 crop 재계산 — applyCrop이 renderer/camera/uniform을 함께 갱신
    const handleResize = (): void => {
      refreshCropRef.current();
    };

    window.addEventListener('resize', handleResize);

    if (noteBuffer.activeCount > 0 && !isAnimating.current) {
      resetFrameClock(frameClockRef.current);
      animationScheduler.add(animate);
      isAnimating.current = true;
    }

    const frameClock = frameClockRef.current;

    return () => {
      unsubscribe();
      window.removeEventListener('resize', handleResize);
      if (isAnimating.current) {
        animationScheduler.remove(animate);
      }
      resetFrameClock(frameClock);
      cropAppliedRef.current = null;
      geometryRef.current?.remove();
      rendererRef.current?.gl
        ?.getExtension('WEBGL_lose_context')
        ?.loseContext?.();
      rendererRef.current = null;
      programRef.current = null;
      geometryRef.current = null;
      cameraRef.current = null;
      sceneRef.current = null;
    };
  }, [noteBuffer]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!programRef.current) return;
    const uniforms = programRef.current.uniforms;
    frameLimitRef.current = normalizeFrameLimit(noteSettings?.frameLimit);
    resetFrameClock(frameClockRef.current);
    uniforms.uFlowSpeed.value =
      noteSettings.speed || DEFAULT_NOTE_SETTINGS.speed;
    uniforms.uTrackHeight.value =
      noteSettings.trackHeight || DEFAULT_NOTE_SETTINGS.trackHeight;
    uniforms.uReverse.value = noteSettings.reverse ? 1.0 : 0.0;
    const fade = resolvedFadeValues(noteSettings);
    uniforms.uFadeFarPx.value = fade.topPx;
    uniforms.uFadeNearPx.value = fade.bottomPx;
  }, [noteSettings]);

  // 트랙 union bounds로 캔버스 crop — backing 크기가 컴포지팅 비용을 결정하므로
  // 창 전체 대신 노트가 그려질 수 있는 영역만 백버퍼로 유지
  useEffect(() => {
    const applyCrop = (rect: CropRect | null): void => {
      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      const program = programRef.current;
      const canvas = canvasRef.current;
      if (!renderer || !camera || !program || !canvas) return;
      if (!rect) {
        canvas.style.display = 'none';
        cropAppliedRef.current = null;
        return;
      }
      const dpr = resolveDpr();
      const windowH = window.innerHeight;
      canvas.style.display = '';
      renderer.dpr = dpr;
      renderer.setSize(rect.w, rect.h);
      canvas.style.left = `${rect.x}px`;
      canvas.style.top = `${rect.y}px`;
      // OGL Camera.orthographic은 `this.left || -1` 폴백이 있어 경계값 0이 -1로
      // 오염될 수 있음 — 네 경계값을 항상 명시적으로 전달
      camera.orthographic({
        left: rect.x,
        right: rect.x + rect.w,
        top: windowH - rect.y,
        bottom: windowH - (rect.y + rect.h),
      });
      program.uniforms.uScreenHeight.value = windowH;
      cropAppliedRef.current = { rect, windowH, dpr };
    };

    const refreshCrop = (): void => {
      const trackHeight =
        noteSettings?.trackHeight || DEFAULT_NOTE_SETTINGS.trackHeight;
      const desired = computeTrackBounds(tracks, trackHeight);
      const applied = cropAppliedRef.current;
      // 노트가 살아있는 동안엔 확장만 — 축소는 버퍼가 빌 때 반영 (기존 노트 클리핑 방지)
      let next = desired;
      if (noteBuffer && noteBuffer.activeCount > 0 && applied) {
        next = desired ? unionCropRect(applied.rect, desired) : applied.rect;
      }
      const sameEnv =
        applied != null &&
        applied.windowH === window.innerHeight &&
        applied.dpr === resolveDpr();
      if (
        cropRectEquals(next, applied?.rect ?? null) &&
        (next == null || sameEnv)
      ) {
        return;
      }
      applyCrop(next);
    };

    refreshCropRef.current = refreshCrop;
    refreshCrop();
  }, [tracks, noteSettings, noteBuffer]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
