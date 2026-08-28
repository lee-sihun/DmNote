import overlayLockClip from '@assets/mp4/overlay-lock.mp4';
import alwaysOnTopClip from '@assets/mp4/always-on-top.mp4';
import noteEffectClip from '@assets/mp4/note-effect.mp4';
import keyCounterClip from '@assets/mp4/key-counter.mp4';
import trayEnabledClip from '@assets/mp4/tray-enabled.mp4';
import customCssClip from '@assets/mp4/custom-css.mp4';
import customJsClip from '@assets/mp4/custom-js.mp4';
import resizeAnchorClip from '@assets/mp4/resize-anchor.mp4';
import obsModeClip from '@assets/mp4/obs-mode.mp4';
import overlayLockLight from '@assets/mp4/light/overlay-lock.mp4';
import alwaysOnTopLight from '@assets/mp4/light/always-on-top.mp4';
import noteEffectLight from '@assets/mp4/light/note-effect.mp4';
import keyCounterLight from '@assets/mp4/light/key-counter.mp4';
import trayEnabledLight from '@assets/mp4/light/tray-enabled.mp4';
import customCssLight from '@assets/mp4/light/custom-css.mp4';
import customJsLight from '@assets/mp4/light/custom-js.mp4';
import resizeAnchorLight from '@assets/mp4/light/resize-anchor.mp4';
import obsModeLight from '@assets/mp4/light/obs-mode.mp4';
import type { ResolvedUiTheme } from '@src/types/settings/settings';

/*
 * 클립은 1036x748로 렌더한다. 미리보기 창 518x374의 2배다.
 *
 * 374는 창 내부 488에서 TitleBar 30과 ToolBar 60을 빼고 상하 여백 24를 뺀 값이다.
 * 두 막대의 h-[30px], h-[60px]은 box-sizing이 border-box라 테두리를 포함한다.
 * 테두리를 밖에 더해 372로 잡으면 object-cover가 0.54% 확대하면서 1px 선이
 * 서브픽셀에 퍼지고, 압축 잡음이 선이 흔들리는 것처럼 보인다.
 * 창 크기나 두 막대 높이를 바꾸면 클립도 다시 렌더해야 한다.
 *
 * 테마별로 한 벌씩 있다. 구성·모션·길이는 완전히 같고 색만 다르다 -
 * video 프로젝트가 tokens.css를 렌더 시점에 읽으므로 같은 컴포지션을
 * data-theme만 바꿔 두 번 뽑는다 (video/README.md 참조)
 */
export interface PreviewClip {
  src: Record<ResolvedUiTheme, string>;
  /** 영상 아래에 겹치는 설명 문구의 i18n 키 */
  caption: string;
}

// 설정 미리보기 영상. 번들에 포함해 오프라인에서도 즉시 재생
export const PREVIEW_CLIPS: Record<string, PreviewClip> = {
  overlayLock: {
    src: { dark: overlayLockClip, light: overlayLockLight },
    caption: 'settings.overlayLockDesc',
  },
  alwaysOnTop: {
    src: { dark: alwaysOnTopClip, light: alwaysOnTopLight },
    caption: 'settings.alwaysOnTopDesc',
  },
  noteEffect: {
    src: { dark: noteEffectClip, light: noteEffectLight },
    caption: 'settings.noteEffectDesc',
  },
  keyCounter: {
    src: { dark: keyCounterClip, light: keyCounterLight },
    caption: 'settings.keyCounterDesc',
  },
  trayEnabled: {
    src: { dark: trayEnabledClip, light: trayEnabledLight },
    caption: 'settings.trayEnabledDesc',
  },
  customCSS: {
    src: { dark: customCssClip, light: customCssLight },
    caption: 'settings.customCSSDesc',
  },
  customJS: {
    src: { dark: customJsClip, light: customJsLight },
    caption: 'settings.customJSDesc',
  },
  resizeAnchor: {
    src: { dark: resizeAnchorClip, light: resizeAnchorLight },
    caption: 'settings.resizeAnchorDesc',
  },
  obsMode: {
    src: { dark: obsModeClip, light: obsModeLight },
    caption: 'settings.obsGuide',
  },
};

export const PREVIEW_KEYS = Object.keys(PREVIEW_CLIPS);
