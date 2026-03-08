import React from 'react';
import { createRoot } from 'react-dom/client';
import '@styles/global.css';
import { initIpcShim, disposeIpcShim } from '@api/ipcShim';

async function bootstrap() {
  // URL 파라미터에서 WS 접속 정보 추출
  const params = new URLSearchParams(window.location.search);
  const host = params.get('host') || window.location.hostname || '127.0.0.1';
  const port = params.get('port') || window.location.port || '34891';
  const token = params.get('token') || '';
  const wsUrl = `ws://${host}:${port}`;

  try {
    // 1. IPC shim 설치 (WS 연결 + snapshot 수신 대기)
    await initIpcShim(wsUrl, token);

    // 2. window.api 설치 (shim 위에서 동작)
    await import('@api/dmnoteApi');

    // 3. OBS 윈도우 타입 표시
    window.__dmn_window_type = 'overlay';

    // 4. overlay/App.tsx를 I18nProvider로 래핑하여 렌더
    const { I18nProvider } = await import('@contexts/I18nContext');
    const { default: App } = await import('@src/renderer/windows/overlay/App');

    const container = document.getElementById('root')!;
    const root = createRoot(container);
    root.render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
  } catch (error) {
    const err = error as Error;
    console.error('[OBS] Failed to bootstrap:', err);
    disposeIpcShim();

    const pre = document.createElement('pre');
    pre.style.cssText = 'color: red; padding: 20px;';
    pre.textContent = `OBS Error: ${err.message}\n${err.stack}`;
    document.body.replaceChildren(pre);
  }
}

bootstrap();
