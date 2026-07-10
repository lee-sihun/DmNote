import '@api/dmnoteApi';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { I18nProvider } from '@contexts/I18nContext';
import '@styles/tokens.css';
import '@styles/global.css';
import '@styles/main.css';

window.__dmn_window_type = 'main';

const container = document.getElementById('root');
if (!container) throw new Error('Root container not found');

// 브라우저 컨텍스트 메뉴 비활성화
document.addEventListener(
  'contextmenu',
  (e) => {
    e.preventDefault();
  },
  { capture: true },
);

const root = createRoot(container);
root.render(
  <I18nProvider>
    <App />
  </I18nProvider>,
);
