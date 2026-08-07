import '@styles/tokens.css';
import '@styles/global.css';
import '@styles/main.css';

const benchmarkName = new URLSearchParams(window.location.search).get(
  'benchmark',
);

const bootstrapBenchmark = async (): Promise<boolean> => {
  if (benchmarkName !== 'shadow-toggle') return false;
  const { mountShadowToggleBenchmark } = await import(
    '../../benchmarks/shadowToggleBenchmark'
  );
  mountShadowToggleBenchmark();
  return true;
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
