import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// Registered after load so the worker never competes with the first paint.
// Dev is excluded: a cache-first shell would serve stale modules over HMR.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // Offline still works via IndexedDB; only shell precaching is lost.
      console.warn('Service worker registration failed:', error);
    });
  });
}
