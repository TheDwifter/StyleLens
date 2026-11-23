import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Sheen: feed the pointer position to whichever button is under it (see index.css). One passive,
// delegated listener for the whole panel; it only writes two CSS variables.
document.addEventListener(
  'pointermove',
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const el = target?.closest<HTMLElement>('.sl-btn-white, .sl-btn-carbon, .sl-sheen');
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--sl-mx', `${event.clientX - rect.left}px`);
    el.style.setProperty('--sl-my', `${event.clientY - rect.top}px`);
  },
  { passive: true }
);

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('StyleLens sidepanel root element missing.');
}

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
