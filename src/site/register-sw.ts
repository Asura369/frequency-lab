/**
 * Registers the offline worker in production and offers a reload when a new
 * version is waiting. The workbench can be mid-session, so the swap is never
 * forced: the user decides when to reload.
 */

if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        registration.update().catch(() => undefined);

        const offer = (worker: ServiceWorker | null) => {
          if (!worker || !navigator.serviceWorker.controller) return;
          showBanner(registration);
        };

        offer(registration.waiting);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed') offer(worker);
          });
        });
      })
      .catch(() => undefined);
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) window.location.reload();
  });

  function showBanner(registration: ServiceWorkerRegistration): void {
    if (document.querySelector('.sw-update')) return;
    const banner = document.createElement('div');
    banner.className = 'sw-update';
    banner.setAttribute('role', 'status');

    const text = document.createElement('span');
    text.textContent = 'A new version is ready.';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Reload';

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'ghost';
    dismiss.textContent = 'Later';
    dismiss.addEventListener('click', () => banner.remove());

    button.addEventListener('click', () => {
      refreshing = true;
      const waiting = registration.waiting;
      if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
      else window.location.reload();
    });

    banner.append(text, button, dismiss);
    document.body.appendChild(banner);
  }
}
