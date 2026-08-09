import { bootstrapApp } from './app/bootstrap.js';

function startApp() {
  bootstrapApp().catch((error) => {
    console.error('TAA application bootstrap failed:', error);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}
