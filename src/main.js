import {
  bootstrapApp,
  captureAuthCallback,
  consumeAuthCallbackHandoff,
  prepareAuthSurface,
} from './app/bootstrap.js';

consumeAuthCallbackHandoff();
captureAuthCallback();
prepareAuthSurface();

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
