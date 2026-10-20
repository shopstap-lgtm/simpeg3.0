/**
 * SIMPEG Korwil Cibitung 2.0 - Client Utilities
 */

// Global Auto-Renderer for Lucide Icons
// Ensures dynamically created DOM nodes (e.g., Alpine.js templates, modals, x-for loops)
// immediately have their lucide icons rendered without needing any user click!
(function initLucideAutoObserver() {
  let debounceFrame = null;
  function triggerLucideIcons() {
    if (!window.lucide || typeof window.lucide.createIcons !== 'function') return;
    if (debounceFrame) cancelAnimationFrame(debounceFrame);
    debounceFrame = requestAnimationFrame(() => {
      window.lucide.createIcons();
    });
  }

  // Initial rendering
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', triggerLucideIcons);
  } else {
    triggerLucideIcons();
  }

  // Observe DOM additions and attribute changes for [data-lucide]
  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver((mutations) => {
      let needsRefresh = false;
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === 'childList' && m.addedNodes.length > 0) {
          for (let j = 0; j < m.addedNodes.length; j++) {
            const node = m.addedNodes[j];
            if (node.nodeType === 1) { // ELEMENT_NODE
              if (node.hasAttribute('data-lucide') || (node.querySelector && node.querySelector('[data-lucide]'))) {
                needsRefresh = true;
                break;
              }
            }
          }
        } else if (m.type === 'attributes' && m.attributeName === 'data-lucide') {
          needsRefresh = true;
        }
        if (needsRefresh) break;
      }
      if (needsRefresh) {
        triggerLucideIcons();
      }
    });

    const startObserving = () => {
      const target = document.body || document.documentElement;
      if (target) {
        observer.observe(target, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-lucide']
        });
      } else {
        document.addEventListener('DOMContentLoaded', startObserving);
      }
    };
    startObserving();
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  console.log('SIMPEG Korwil Cibitung 2.0 Frontend Loaded.');

  // Real-time visitor heartbeat (ultra-lightweight, 0% DB load)
  (function initPresence() {
    try {
      let vid = sessionStorage.getItem('_simpeg_vid');
      if (!vid) {
        vid = 'v_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
        sessionStorage.setItem('_simpeg_vid', vid);
      }

      function sendPing() {
        const payload = JSON.stringify({ clientId: vid, path: window.location.pathname });
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/presence/ping', new Blob([payload], { type: 'application/json' }));
        } else {
          fetch('/api/presence/ping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true
          }).catch(() => {});
        }
      }

      function sendLeave() {
        const payload = JSON.stringify({ clientId: vid });
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/presence/leave', new Blob([payload], { type: 'application/json' }));
        }
      }

      // Initial ping on page load
      sendPing();

      // Recurring ping every 45 seconds while tab is open
      setInterval(sendPing, 45000);

      // Best-effort cleanup when user closes or leaves tab
      window.addEventListener('pagehide', sendLeave, { capture: true });
    } catch (e) {
      // Ignore errors on restricted storage
    }
  })();
});
