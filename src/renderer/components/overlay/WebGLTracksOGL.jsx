import React, { memo, useEffect, useRef } from 'react';
import { Renderer, Camera, Transform, Program, Geometry, Mesh } from 'ogl';
import { animationScheduler } from '../../utils/animationScheduler';
import { resolvedFadeValues } from '../../../types/noteSettings';
import { MAX_NOTES } from '@stores/noteBuffer';
import { isMac } from '@utils/platform';

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
  varying float vTrackTopY;
  varying float vTrackBottomY;
  varying float vReverse;
  varying float vNoteTopY;
  varying float vNoteBottomY;

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

    if (noteBottomY <= trackTopY || noteBottomY < 0.0) {
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
    vTrackTopY = trackTopY;
    vTrackBottomY = trackBottomY;
    vReverse = uReverse;
    vNoteTopY = noteTopY;
    vNoteBottomY = noteBottomY;
  }
`;

const fragmentShader = `
  precision highp float;

  uniform float uScreenHeight;
  uniform float uDpr;
  uniform float uFadeTopPx;
  uniform float uFadeBottomPx;

  varying vec4 vColorTop;
  varying vec4 vColorBottom;
  varying vec2 vLocalPos;
  varying vec2 vHalfSize;
  varying float vRadius;
  varying float vGlowSize;
  varying vec2 vGlowOpacity;
  varying vec3 vGlowColorTop;
  varying vec3 vGlowColorBottom;
  varying float vTrackTopY;
  varying float vTrackBottomY;
  varying float vNoteTopY;
  varying float vNoteBottomY;

  void main() {
    // gl_FragCoord is in physical pixels on high-DPI displays (DPR > 1, e.g., macOS Retina).
    // Convert to CSS pixels so it matches DOM-based track coordinates.
    // max(uDpr, 1.0) also guards against uDpr being 0.0 or an invalid value.
    float currentDOMY = uScreenHeight - (gl_FragCoord.y / max(uDpr, 1.0));
    float trackHeight = max(vTrackBottomY - vTrackTopY, 0.0001);
    float gradientRatio = clamp((currentDOMY - vTrackTopY) / trackHeight, 0.0, 1.0);
    float trackRelativeY = gradientRatio;

    vec4 baseColor = mix(vColorTop, vColorBottom, gradientRatio);
    vec3 glowColor = mix(vGlowColorTop, vGlowColorBottom, gradientRatio);
    float glowOpacity = mix(vGlowOpacity.x, vGlowOpacity.y, gradientRatio);

    float r = clamp(vRadius, 0.0, min(vHalfSize.x, vHalfSize.y));
    vec2 q = abs(vLocalPos) - (vHalfSize - vec2(r));
    float dist = length(max(q, 0.0)) - r;
    float aa = 1.0;
    float bodyMask = clamp(1.0 - dist / aa, 0.0, 1.0);
    float bodyAlpha = baseColor.a * bodyMask;

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
    glowAlpha *= fadeMask;

    float outAlpha = clamp(bodyAlpha + glowAlpha, 0.0, 1.0);
    vec3 outColor = baseColor.rgb * bodyAlpha + glowColor * glowAlpha;
    gl_FragColor = vec4(outColor, outAlpha);
  }
`;

const buildPlaneGeometry = (gl) =>
  new Geometry(gl, {
    position: {
      size: 3,
      data: new Float32Array([
        -0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0,
        -0.5, 0.5, 0,
      ]),
    },
  });

const INSTANCED_ATTRIBUTE_KEYS = Object.freeze([
  'noteInfo',
  'noteSize',
  'noteColorTop',
  'noteColorBottom',
  'noteRadius',
  'noteGlow',
  'noteGlowColorTop',
  'noteGlowColorBottom',
  'trackIndex',
]);

const FINALIZE_ATTRIBUTE_KEYS = Object.freeze(['noteInfo']);

const markAttributesDirty = (geometry, keys) => {
  if (!geometry) return;
  const attributes = geometry.attributes;
  if (!attributes) return;
  const targetKeys = keys ?? Object.keys(attributes);
  targetKeys.forEach((key) => {
    const attr = attributes[key];
    if (attr) {
      attr.needsUpdate = true;
    }
  });
};

const markInstancedAttributesDirty = (
  geometry,
  activeCount,
  keys = INSTANCED_ATTRIBUTE_KEYS,
) => {
  if (!geometry) return;
  geometry.instancedCount = Math.min(activeCount, MAX_NOTES);
  markAttributesDirty(geometry, keys);
};

const queueAttributeUpload = (pendingUpdate, keys, activeCount = undefined) => {
  if (!pendingUpdate) return;
  if (activeCount !== undefined) {
    pendingUpdate.instancedCount = Math.min(activeCount, MAX_NOTES);
  }
  keys.forEach((key) => pendingUpdate.dirtyKeys.add(key));
  pendingUpdate.dirtySinceFrame = true;
};

const normalizeFrameLimit = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : 0;
};

const FRAME_PACING_EPSILON_MS = 0.3;
const MAX_DRIFT_FRAMES = 8;
const MACOS_DPR_CAP = 1;

const resetFrameClock = (frameClock) => {
  if (!frameClock) return;
  frameClock.nextFrameTime = 0;
  frameClock.stableTime = 0;
};

export const WebGLTracksOGL = memo(
  ({
    tracks: _tracks,
    notesRef: _notesRef,
    subscribe,
    noteSettings,
    laboratoryEnabled,
    noteBuffer,
  }) => {
    const canvasRef = useRef();
    const rendererRef = useRef();
    const sceneRef = useRef();
    const cameraRef = useRef();
    const programRef = useRef();
    const geometryRef = useRef();
    const isAnimating = useRef(false);
    const lastVersionRef = useRef(noteBuffer?.version ?? 0);
    const pendingUpdateRef = useRef({
      dirtyKeys: new Set(),
      dirtySinceFrame: false,
      instancedCount: null,
    });
    const frameLimitRef = useRef(normalizeFrameLimit(noteSettings?.frameLimit));
    const frameClockRef = useRef({ nextFrameTime: 0, stableTime: 0 });

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !noteBuffer) return;
      const macOS = isMac();
      const resolveDpr = () => {
        const rawDpr = window.devicePixelRatio || 1;
        return macOS ? Math.min(rawDpr, MACOS_DPR_CAP) : rawDpr;
      };
      const initialDpr = resolveDpr();

      const renderer = new Renderer({
        canvas,
        alpha: true,
        antialias: false,
        dpr: initialDpr,
        premultipliedAlpha: true,
      });
      renderer.setSize(window.innerWidth, window.innerHeight);
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
      // OGL Camera.orthographic() uses `this.left || -1` defaults, so `left/bottom = 0`
      // can incorrectly become `-1` when updateProjectionMatrix() is used.
      // Force an explicit orthographic projection so WebGL coords match DOM pixels 1:1.
      camera.orthographic({
        left: 0,
        right: window.innerWidth,
        top: window.innerHeight,
        bottom: 0,
      });
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
      geometry.addAttribute('trackIndex', {
        instanced: 1,
        size: 1,
        data: noteBuffer.trackIndex,
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
          uFlowSpeed: { value: noteSettings.speed || 180 },
          uScreenHeight: { value: window.innerHeight },
          uDpr: { value: initialDpr },
          uTrackHeight: { value: noteSettings.trackHeight || 150 },
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
      mesh.setParent(scene);

      const animate = (currentTime) => {
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

        // 프레임 시작 시 배치 업데이트 적용
        if (pendingUpdateRef.current.dirtySinceFrame) {
          const geometryTarget = geometryRef.current;
          if (geometryTarget) {
            if (pendingUpdateRef.current.instancedCount != null) {
              geometryTarget.instancedCount =
                pendingUpdateRef.current.instancedCount;
            }
            if (pendingUpdateRef.current.dirtyKeys.size > 0) {
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

        programRef.current.uniforms.uTime.value = renderTime;
        rendererRef.current.render({
          scene: sceneRef.current,
          camera: cameraRef.current,
        });
      };

      const handleNoteEvent = (event) => {
        if (!event) return;
        const geometryTarget = geometryRef.current;
        if (!geometryTarget) return;

        if (event.activeCount !== undefined) {
          geometryTarget.instancedCount = Math.min(
            event.activeCount,
            MAX_NOTES,
          );
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
            markInstancedAttributesDirty(
              geometryTarget,
              noteBuffer.activeCount,
            );
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
                context.clear(
                  context.COLOR_BUFFER_BIT | context.DEPTH_BUFFER_BIT,
                );
              });
            }
            break;
          default:
            break;
        }
      };

      const unsubscribe = subscribe(handleNoteEvent);

      const handleResize = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const dpr = resolveDpr();
        // Keep renderer/program in sync when moving between monitors with different DPR.
        renderer.dpr = dpr;
        renderer.setSize(width, height);
        if (cameraRef.current) {
          cameraRef.current.orthographic({
            left: 0,
            right: width,
            top: height,
            bottom: 0,
          });
        }
        if (programRef.current) {
          programRef.current.uniforms.uScreenHeight.value = height;
          programRef.current.uniforms.uDpr.value = dpr;
        }
      };

      window.addEventListener('resize', handleResize);
      handleResize();

      if (noteBuffer.activeCount > 0 && !isAnimating.current) {
        resetFrameClock(frameClockRef.current);
        animationScheduler.add(animate);
        isAnimating.current = true;
      }

      return () => {
        unsubscribe();
        window.removeEventListener('resize', handleResize);
        if (isAnimating.current) {
          animationScheduler.remove(animate);
        }
        resetFrameClock(frameClockRef.current);
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
    }, [noteBuffer, subscribe]);

    useEffect(() => {
      if (!programRef.current) return;
      const uniforms = programRef.current.uniforms;
      frameLimitRef.current = normalizeFrameLimit(noteSettings?.frameLimit);
      resetFrameClock(frameClockRef.current);
      uniforms.uFlowSpeed.value = noteSettings.speed || 180;
      uniforms.uTrackHeight.value = noteSettings.trackHeight || 150;
      uniforms.uReverse.value = noteSettings.reverse ? 1.0 : 0.0;
      const fade = resolvedFadeValues(noteSettings);
      uniforms.uFadeTopPx.value = fade.topPx;
      uniforms.uFadeBottomPx.value = fade.bottomPx;
    }, [
      noteSettings.speed,
      noteSettings.trackHeight,
      noteSettings.reverse,
      noteSettings.frameLimit,
      noteSettings.fadeTopPx,
      noteSettings.fadeBottomPx,
      noteSettings.reverseFadeTopPx,
      noteSettings.reverseFadeBottomPx,
    ]);

    return (
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />
    );
  },
);
