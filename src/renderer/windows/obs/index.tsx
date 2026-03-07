import React from 'react';
import { createRoot } from 'react-dom/client';
import '@styles/global.css';

async function bootstrap() {
  try {
    const { default: App } = await import('./App');
    const container = document.getElementById('root')!;
    const root = createRoot(container);
    root.render(<App />);
  } catch (error) {
    const err = error as Error;
    console.error('[OBS] Failed to mount React app:', err);
    document.body.innerHTML = `<pre style="color: red; padding: 20px;">OBS Error: ${err.message}\n${err.stack}</pre>`;
  }
}

bootstrap();
