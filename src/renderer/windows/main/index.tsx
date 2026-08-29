import '@styles/tokens.css';
import '@styles/global.css';
import '@styles/main.css';

const benchmarkName = new URLSearchParams(window.location.search).get(
  'benchmark',
);

const bootstrapBenchmark = async (): Promise<boolean> => {
  if (benchmarkName === 'shadow-toggle') {
    const { mountShadowToggleBenchmark } = await import(
      '../../benchmarks/shadowToggleBenchmark'
    );
    mountShadowToggleBenchmark();
    return true;
  }
  if (benchmarkName === 'webview-interactions') {
    const query = new URLSearchParams(window.location.search);
    const reportUrl = query.get('report');
    const reportFailure = (error: unknown) => {
      if (!reportUrl) return;
      void fetch(reportUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          benchmark: query.get('scenario'),
          strategy: query.get('strategy'),
          error: String(error),
        }),
      });
    };
    window.addEventListener('error', (event) => reportFailure(event.error));
    window.addEventListener('unhandledrejection', (event) =>
      reportFailure(event.reason),
    );
    const { mountWebViewInteractionBenchmark } = await import(
      '../../benchmarks/webviewInteractionBenchmark'
    );
    mountWebViewInteractionBenchmark();
    return true;
  }
  return false;
};

async function bootstrap() {
  if (await bootstrapBenchmark()) return;

  window.__dmn_window_type = 'main';
  window.__dmn_runtime = 'tauri';

  // 브라우저 컨텍스트 메뉴 비활성화
  document.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault();
    },
    { capture: true },
  );

  await import('@api/dmnoteApi');

  // 업데이트 UI 시뮬레이터, 개발 빌드에만 들어간다 (콘솔에서 __dmn_updateSim())
  // 보조 도구가 앱 부팅을 막으면 안 되므로 실패는 여기서 끊는다
  if (import.meta.env.DEV) {
    try {
      const { installUpdateSimulator } = await import(
        '../../dev/updateSimulator'
      );
      installUpdateSimulator();
    } catch (error) {
      console.error('[UpdateSim] 시뮬레이터 설치 실패', error);
    }
  }

  const [{ createRoot }, { I18nProvider }, { default: App }] =
    await Promise.all([
      import('react-dom/client'),
      import('@contexts/I18nContext'),
      import('./App'),
    ]);
  const container = document.getElementById('root');
  if (!container) throw new Error('Root container not found');

  const root = createRoot(container);
  root.render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

void bootstrap();
