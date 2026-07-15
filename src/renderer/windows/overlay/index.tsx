import '@styles/tokens.css';
import '@styles/global.css';

window.__dmn_window_type = 'overlay';
window.__dmn_runtime = 'tauri';

async function bootstrap() {
  try {
    await import('@api/dmnoteApi');
    const [{ createRoot }, { I18nProvider }, { default: App }] =
      await Promise.all([
        import('react-dom/client'),
        import('@contexts/I18nContext'),
        import('./App'),
      ]);
    const container = document.getElementById('root')!;
    const root = createRoot(container);
    root.render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
  } catch (error) {
    const err = error as Error;
    console.error('[Overlay] Failed to mount React app:', err);
    document.body.innerHTML = `<pre style="color: red; padding: 20px;">Overlay Error: ${err.message}\n${err.stack}</pre>`;
  }
}

void bootstrap();
