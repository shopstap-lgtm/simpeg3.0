/**
 * SIMPEG Korwil Cibitung 2.0 - Client Utilities
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

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
