import '@api/dmnoteApi';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '@contexts/I18nContext';
import '@styles/global.css';

async function bootstrap() {
  try {
    const { default: App } = await import('./App');
    const container = document.getElementById('root');
    const root = createRoot(container);
    root.render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
  } catch (error) {
    console.error('[Overlay] Failed to mount React app:', error);
    document.body.innerHTML = `<pre style="color: red; padding: 20px;">Overlay Error: ${error.message}\n${error.stack}</pre>`;
  }
}

bootstrap();
