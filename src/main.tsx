import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

// Registro automático del Service Worker para funcionamiento sin internet (PWA)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Si el navegador restringe Service Workers en modo privado, la app sigue funcionando con IndexedDB
    });
  });
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
