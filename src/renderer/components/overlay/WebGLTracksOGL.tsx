import React, { useEffect, useRef } from 'react';
import {
  Renderer,
  Camera,
  Transform,
  Program,
  Geometry,
  Mesh,
  Texture,
} from 'ogl';
import type { OGLRenderingContext } from 'ogl';
import { animationScheduler } from '@utils/animation/animationScheduler';
import { DEFAULT_NOTE_SETTINGS } from '@constants/overlayDefaults';
import { resolvedFadeValues } from '@src/types/settings/noteSettings';
import type { NoteSettings } from '@src/types/settings/noteSettings';
import {
  MAX_NOTES,
  GRADIENT_LUT_WIDTH,
  GRADIENT_LUT_ROWS,
  resolvedGlowSize,
  type TrackLayoutInput,
} from '@stores/signals/noteBuffer';

const vertexShader = `
  attribute vec3 position;
  attribute vec3 noteInfo; // x: startTime, y: endTime, z: trackX
  attribute vec2 noteSize; // x: width, y: trackBottomY
  attribute vec4 noteColorTop;
  attribute vec4 noteColorBottom;
  attribute float noteRadius;
  attribute vec3 noteGlow; // x: glow size, y: glow opacity top (0-1), z: glow opacity bottom (0-1)
  attribute vec3 noteGlowColorTop;
  attribute vec3 noteGlowColorBottom;
  attribute vec4 noteBorder; // x: width, yzw: RGB color
  attribute float noteBorderOpacity; // 0-1, 노트 배경 투명도와 독립
  attribute vec2 noteBorderGradientInfo; // x: LUT 행 (-1 = 단색), y: 각도 라디안
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
  varying vec3 vBorderGradient; // x: LUT 행, y: sin(각도), z: cos(각도)
  varying float vTrackTopY;
  varying float vTrackBottomY;

  void main() {
    float startTime = noteInfo.x;
    float endTime = noteInfo.y;
    float trackX = noteInfo.z;
    float trackBottomY = noteSize.y;
    float noteWidth = noteSize.x;

    if (startTime == 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
      vColorTop = vec4(0.0);
      vColorBottom = vec4(0.0);
      return;
    }

    bool isActive = endTime == 0.0;
    float rawNoteLength = 0.0;
    float glowSize = max(noteGlow.x, 0.0);
    float glowOpacityTop = clamp(noteGlow.y, 0.0, 1.0);
    float glowOpacityBottom = clamp(noteGlow.z, 0.0, 1.0);

    if (isActive) {
      rawNoteLength = max(0.0, (uTime - startTime) * uFlowSpeed / 1000.0);
    } else {
      rawNoteLength = max(0.0, (endTime - startTime) * uFlowSpeed / 1000.0);
    }

    float noteLength = min(rawNoteLength, uTrackHeight);
    float noteTopY;
    float noteBottomY;

    if (isActive) {
      if (uReverse < 0.5) {
        noteBottomY = trackBottomY;
        noteTopY = trackBottomY - noteLength;
      } else {
        float trackTopY_local = trackBottomY - uTrackHeight;
        noteTopY = trackTopY_local;
        noteBottomY = trackTopY_local + noteLength;
      }
    } else {
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
    }

    float trackTopY = trackBottomY - uTrackHeight;
    noteTopY = max(noteTopY, trackTopY);
    noteBottomY = min(noteBottomY, trackBottomY);

    // noteBottomY < noteTopY: 트랙을 벗어난 역방향 완료 노트 —
    // 음수 길이 쿼드 래스터라이즈와 clamp(r, 0, 음수) undefined 방지
    // strict less로 길이 0(스폰 프레임 글로우 퍼프)은 보존
    if (noteBottomY <= trackTopY || noteBottomY < 0.0 || noteBottomY < noteTopY) {
      gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
      vColorTop = vec4(0.0);
      vColorBottom = vec4(0.0);
      return;
    }

    noteLength = noteBottomY - noteTopY;
    float centerCanvasY = (noteTopY + noteBottomY) / 2.0;
    float centerWorldY = uScreenHeight - centerCanvasY;

    float expandedWidth = noteWidth + glowSize * 2.0;
    float expandedLength = noteLength + glowSize * 2.0;

    vec3 transformed = vec3(position.x, position.y, position.z);
    transformed.x *= expandedWidth;
    transformed.y *= expandedLength;
    transformed.x += trackX + noteWidth / 2.0;
    transformed.y += centerWorldY;
    transformed.z = 0.0;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);

    vColorTop = noteColorTop;
    vColorBottom = noteColorBottom;
    vHalfSize = vec2(noteWidth, noteLength) * 0.5;
    vLocalPos = vec2(position.x * expandedWidth, position.y * expandedLength);
    vRadius = noteRadius;
    vGlowSize = glowSize;
    vGlowOpacity = vec2(glowOpacityTop, glowOpacityBottom);
    vGlowColorTop = noteGlowColorTop;
    vGlowColorBottom = noteGlowColorBottom;
    vBorder = noteBorder;
    vBorderOpacity = noteBorderOpacity;
    vBorderGradient = vec3(
      noteBorderGradientInfo.x,
      sin(noteBorderGradientInfo.y),
      cos(noteBorderGradientInfo.y)
    );
    vTrackTopY = trackTopY;
    vTrackBottomY = trackBottomY;
  }
`;

const fragmentShader = `
  precision highp float;

  uniform float uCanvasBottomDomY;
  uniform float uDomPerPx;
  uniform float uFadeTopPx;
  uniform float uFadeBottomPx;
  uniform sampler2D uGradientLUT;

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
  varying vec3 vBorderGradient; // x: LUT 행, y: sin(각도), z: cos(각도)
  varying float vTrackTopY;
  varying float vTrackBottomY;

  void main() {
    // gl_FragCoord는 crop된 캔버스 기준 물리 픽셀 단위
    // uDomPerPx = cssHeight / drawingBufferHeight — 비정수 DPR의 backing 반올림 반영
    // max()는 uniform 미설정/0 방어
    float currentDOMY = uCanvasBottomDomY - gl_FragCoord.y * max(uDomPerPx, 0.0001);
    float trackHeight = max(vTrackBottomY - vTrackTopY, 0.0001);
    float gradientRatio = clamp((currentDOMY - vTrackTopY) / trackHeight, 0.0, 1.0);
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

    // 그라데이션 테두리: 트랙 rect 기준 CSS linear-gradient 투영으로 LUT 샘플.
    // LUT 텍셀은 premultiplied라 paint에는 텍셀 알파를 다시 곱하지 않는다
    vec3 borderPaint = borderColor;
    float borderTexAlpha = 1.0;
    if (vBorderGradient.x >= 0.0) {
      float boxW = max(vHalfSize.x * 2.0, 0.0001);
      float boxH = trackHeight;
      float nx = clamp((vLocalPos.x + vHalfSize.x) / boxW, 0.0, 1.0);
      float px = (nx - 0.5) * boxW;
      float py = (trackRelativeY - 0.5) * boxH;
      float sinA = vBorderGradient.y;
      float cosA = vBorderGradient.z;
      float lineLen = max(abs(boxW * sinA) + abs(boxH * cosA), 0.0001);
      float t = clamp(0.5 + (px * sinA - py * cosA) / lineLen, 0.0, 1.0);
      vec4 texel = texture2D(
        uGradientLUT,
        vec2(t, (vBorderGradient.x + 0.5) / ${GRADIENT_LUT_ROWS}.0)
      );
      borderPaint = texel.rgb;
      borderTexAlpha = texel.a;
    }

    // 테두리 투명도는 노트 배경(baseColor.a)과 독립
    float borderFactor = vBorderOpacity * borderMask;
    float borderAlpha = borderFactor * borderTexAlpha;

    float glowAlpha = 0.0;
    if (vGlowSize > 0.0) {
      float outside = max(dist, 0.0);
      float range = max(vGlowSize, 0.0001);
      float glowFalloff = clamp(1.0 - outside / range, 0.0, 1.0);
      glowAlpha = baseColor.a * glowOpacity * pow(glowFalloff, 2.0);
    }

    float fadeMask = 1.0;
    if (uFadeTopPx > 0.0) {
      float topFadeRatio = uFadeTopPx / trackHeight;
      fadeMask = min(fadeMask, clamp(trackRelativeY / topFadeRatio, 0.0, 1.0));
    }
    if (uFadeBottomPx > 0.0) {
      float bottomFadeRatio = uFadeBottomPx / trackHeight;
      fadeMask = min(fadeMask, clamp((1.0 - trackRelativeY) / bottomFadeRatio, 0.0, 1.0));
    }
    bodyAlpha *= fadeMask;
    borderFactor *= fadeMask;
    borderAlpha *= fadeMask;
    glowAlpha *= fadeMask;

    float outAlpha = clamp(bodyAlpha + borderAlpha + glowAlpha, 0.0, 1.0);
    vec3 borderContrib = borderFactor > 0.0 ? borderPaint * borderFactor : vec3(0.0);
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
  'noteBorderGradientInfo',
  'trackIndex',
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
// 노트 캔버스 backing 배율 상한 - 좌표계가 CSS px라 위치·크기는 그대로, 픽셀 밀도만 줄어듦
// GPU 드로우는 fill 비례라 고배율 화면에서 절반~1/3로 감소
const NOTE_DPR_CAP = 1;

const resolveDpr = (): number => {
  const rawDpr = window.devicePixelRatio || 1;
  return Math.min(rawDpr, NOTE_DPR_CAP);
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
    minX = Math.min(minX, track.position.dx - pad);
    maxX = Math.max(maxX, track.position.dx + track.width + pad);
    // 셰이더는 uTrackHeight 기준으로 노트를 클램프하므로 per-track height 대신 설정값 사용
    minY = Math.min(minY, track.position.dy - trackHeight - pad);
    maxY = Math.max(maxY, track.position.dy + pad);
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
  noteBorderGradientInfo: Float32Array;
  trackIndex: Float32Array;
  gradientLUT: Uint8Array;
  gradientLUTVersion: number;
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
    geometry.addAttribute('noteBorderGradientInfo', {
      instanced: 1,
      size: 2,
      data: noteBuffer.noteBorderGradientInfo,
      usage: gl.DYNAMIC_DRAW,
    });
    geometry.addAttribute('trackIndex', {
      instanced: 1,
      size: 1,
      data: noteBuffer.trackIndex,
      usage: gl.DYNAMIC_DRAW,
    });
    markInstancedAttributesDirty(geometry, noteBuffer.activeCount);
    geometryRef.current = geometry;

    // 테두리 그라데이션 LUT — 고정 용량, 내용만 갱신 (행은 append-only)
    const gradientLUTTexture = new Texture(gl, {
      image: noteBuffer.gradientLUT,
      width: GRADIENT_LUT_WIDTH,
      height: GRADIENT_LUT_ROWS,
      generateMipmaps: false,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
      flipY: false,
      premultiplyAlpha: false,
    });
    let appliedLUTVersion = noteBuffer.gradientLUTVersion;

    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uGradientLUT: { value: gradientLUTTexture },
        uFlowSpeed: {
          value: noteSettings.speed || DEFAULT_NOTE_SETTINGS.speed,
        },
        uScreenHeight: { value: window.innerHeight },
        uCanvasBottomDomY: { value: window.innerHeight },
        uDomPerPx: { value: 1 },
        uTrackHeight: {
          value: noteSettings.trackHeight || DEFAULT_NOTE_SETTINGS.trackHeight,
        },
        uReverse: { value: noteSettings.reverse ? 1.0 : 0.0 },
        uFadeTopPx: { value: resolvedFadeValues(noteSettings).topPx },
        uFadeBottomPx: { value: resolvedFadeValues(noteSettings).bottomPx },
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

      // LUT에 새 행이 래스터라이즈됐으면 프레임 시작에 재업로드 예약
      if (appliedLUTVersion !== noteBuffer.gradientLUTVersion) {
        appliedLUTVersion = noteBuffer.gradientLUTVersion;
        gradientLUTTexture.needsUpdate = true;
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
    uniforms.uFadeTopPx.value = fade.topPx;
    uniforms.uFadeBottomPx.value = fade.bottomPx;
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
      program.uniforms.uCanvasBottomDomY.value = rect.y + rect.h;
      // 비정수 DPR에서 backing 반올림까지 반영한 정확 CSS px/물리 px 비율
      program.uniforms.uDomPerPx.value =
        rect.h / Math.max(renderer.gl.drawingBufferHeight, 1);
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
