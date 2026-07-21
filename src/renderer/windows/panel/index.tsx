import '@styles/tokens.css';
import '@styles/global.css';
// PropertiesPanel의 스크롤 뷰포트·서브 페이지·backdrop 스타일 포함
import '@styles/main.css';

window.__dmn_window_type = 'panel';
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

    // 패널 본문 공개 전에 적용할 네이티브 뷰 snapshot 수신
    const [{ usePropertiesPanelStore }, { panelWindowApi }] = await Promise.all(
      [
        import('@stores/grid/usePropertiesPanelStore'),
        import('@api/modules/selectionSessionApi'),
      ],
    );
    usePropertiesPanelStore.getState().setCanvasPanelOpen(true);
    const viewState = await panelWindowApi.takeViewState();

    const container = document.getElementById('root')!;
    const root = createRoot(container);
    root.render(
      <I18nProvider>
        <App initialViewState={viewState} />
      </I18nProvider>,
    );
  } catch (error) {
    const err = error as Error;
    console.error('[Panel] Failed to mount React app:', err);
    const fallback = document.createElement('pre');
    fallback.style.color = 'red';
    fallback.style.padding = '20px';
    fallback.textContent = `Panel Error: ${err.message}\n${err.stack ?? ''}`;
    document.body.replaceChildren(fallback);
  }
}

void bootstrap();
