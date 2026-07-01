import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

/** Errors on a device we can't attach devtools to are otherwise invisible.
 * A plain-DOM banner (not React) so it still shows up if React itself fails
 * to render. */
function showErrorBanner(message: string): void {
  let banner = document.getElementById('pkm-error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'pkm-error-banner';
    banner.className = 'pkm-error-banner';
    document.body.prepend(banner);
  }
  banner.textContent = `Error: ${message}`;
}

window.addEventListener('error', (event) => {
  showErrorBanner(event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as unknown;
  showErrorBanner(reason instanceof Error ? reason.message : String(reason));
});

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
