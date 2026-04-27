(() => {
  'use strict';

  // -- State --
  let suggestions = [];
  let currentIndex = 0;
  let processing = false;

  // -- DOM refs --
  const cardEl       = document.getElementById('current-card');
  const emptyEl      = document.getElementById('empty-state');
  const actionBar    = document.getElementById('action-bar');
  const queueCount   = document.getElementById('queue-count');
  const cardAgent    = document.getElementById('card-agent');
  const cardTime     = document.getElementById('card-time');
  const cardTitle    = document.getElementById('card-title');
  const cardDesc     = document.getElementById('card-description');
  const cardCtxWrap  = document.getElementById('card-context-wrap');
  const cardCtx      = document.getElementById('card-context');
  const cardPos      = document.getElementById('card-pos');
  const toastEl      = document.getElementById('toast');

  // -- Toast --
  let toastTimer;
  function showToast(msg) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  // -- Offline banner --
  const offlineBanner = document.createElement('div');
  offlineBanner.className = 'offline-banner';
  offlineBanner.textContent = '⚠ You are offline. Actions will sync when reconnected.';
  document.body.prepend(offlineBanner);

  window.addEventListener('online',  () => offlineBanner.classList.remove('visible'));
  window.addEventListener('offline', () => offlineBanner.classList.add('visible'));
  if (!navigator.onLine) offlineBanner.classList.add('visible');

  // -- Pending offline actions --
  function getPendingActions() {
    try { return JSON.parse(localStorage.getItem('pendingActions') || '[]'); } catch { return []; }
  }

  function savePendingActions(actions) {
    localStorage.setItem('pendingActions', JSON.stringify(actions));
  }

  async function flushPendingActions() {
    const actions = getPendingActions();
    if (!actions.length || !navigator.onLine) return;
    const remaining = [];
    for (const action of actions) {
      try {
        const res = await fetch(`/api/suggestions/${action.id}/${action.action}`, { method: 'PATCH' });
        if (!res.ok) remaining.push(action);
      } catch {
        remaining.push(action);
      }
    }
    savePendingActions(remaining);
    if (remaining.length < actions.length) loadSuggestions();
  }

  window.addEventListener('online', flushPendingActions);

  // -- Format relative time --
  function relativeTime(dateStr) {
    const diff = Date.now() - new Date(dateStr + 'Z').getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  // -- Render current card --
  function renderCard() {
    // API already returns only pending suggestions by default, and we remove items
    // from this array in doAction() as they are approved/rejected.
    const pendingCount = suggestions.length;

    queueCount.textContent = `${pendingCount} pending`;

    if (pendingCount === 0) {
      cardEl.hidden = true;
      actionBar.hidden = true;
      emptyEl.hidden = false;
      return;
    }

    emptyEl.hidden = true;
    cardEl.hidden = false;
    actionBar.hidden = false;

    const s = suggestions[currentIndex % pendingCount];

    cardAgent.textContent = s.agent || 'agent';
    cardTime.textContent  = relativeTime(s.created_at);
    cardTitle.textContent = s.title;
    cardDesc.textContent  = s.description;

    if (s.context) {
      cardCtx.textContent = s.context;
      cardCtxWrap.hidden = false;
    } else {
      cardCtxWrap.hidden = true;
    }

    cardPos.textContent = `${currentIndex % pendingCount + 1} of ${pendingCount}`;
  }

  // -- Load suggestions from server (or cache) --
  async function loadSuggestions() {
    try {
      const res = await fetch('/api/suggestions');
      if (!res.ok) throw new Error('Network error');
      suggestions = await res.json();
      localStorage.setItem('cachedSuggestions', JSON.stringify(suggestions));
    } catch {
      // Fallback to cache when offline
      try {
        suggestions = JSON.parse(localStorage.getItem('cachedSuggestions') || '[]');
      } catch {
        suggestions = [];
      }
    }
    currentIndex = 0;
    renderCard();
  }

  // -- Perform action --
  async function doAction(action) {
    if (processing) return;
    if (!suggestions.length) return;

    processing = true;
    const s = suggestions[currentIndex % suggestions.length];

    // Animate card out
    const animClass = action === 'approve' ? 'exiting-approve' :
                      action === 'reject'  ? 'exiting-reject'  : 'exiting-defer';
    cardEl.classList.add(animClass);

    await new Promise(r => setTimeout(r, 320));
    cardEl.classList.remove(animClass);

    // Optimistic update for defer: it stays pending, just move to next
    if (action === 'defer') {
      currentIndex = (currentIndex + 1) % Math.max(suggestions.length, 1);
      showToast('Deferred — moved to back of queue');
    } else {
      // Optimistically remove from pending view by updating suggestions array
      const sIdx = currentIndex % suggestions.length;
      suggestions.splice(sIdx, 1);

      if (suggestions.length === 0 || currentIndex >= suggestions.length) {
        currentIndex = 0;
      }
      showToast(action === 'approve' ? '✓ Approved' : '✗ Rejected');
    }

    renderCard();
    processing = false;

    // Sync with server
    if (navigator.onLine) {
      try {
        const res = await fetch(`/api/suggestions/${s.id}/${action}`, { method: 'PATCH' });
        if (!res.ok) throw new Error();
        const updated = await res.json();
        // Reconcile local copy
        const idx = suggestions.findIndex(x => x.id === s.id);
        if (idx !== -1) suggestions[idx] = updated;
        localStorage.setItem('cachedSuggestions', JSON.stringify(suggestions));
      } catch {
        // Queue for later
        const pa = getPendingActions();
        pa.push({ id: s.id, action });
        savePendingActions(pa);
      }
    } else {
      const pa = getPendingActions();
      pa.push({ id: s.id, action });
      savePendingActions(pa);
    }
  }

  // -- Button handlers --
  document.getElementById('btn-approve').addEventListener('click', () => doAction('approve'));
  document.getElementById('btn-reject').addEventListener('click',  () => doAction('reject'));
  document.getElementById('btn-defer').addEventListener('click',   () => doAction('defer'));

  // -- Swipe gestures --
  let touchStartX = 0;
  let touchStartY = 0;
  let isDragging  = false;

  cardEl.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    isDragging = true;
  }, { passive: true });

  cardEl.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    // Tilt the card slightly as user swipes
    cardEl.style.transform = `translateX(${dx * 0.4}px) rotate(${dx * 0.03}deg)`;
  }, { passive: true });

  cardEl.addEventListener('touchend', (e) => {
    if (!isDragging) return;
    isDragging = false;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    cardEl.style.transform = '';

    const THRESHOLD = 80;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > THRESHOLD)       doAction('approve');
      else if (dx < -THRESHOLD) doAction('reject');
    } else {
      if (dy < -THRESHOLD) doAction('defer');
    }
  }, { passive: true });

  // -- Keyboard shortcuts (desktop) --
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'a') doAction('approve');
    if (e.key === 'ArrowLeft'  || e.key === 'z') doAction('reject');
    if (e.key === 'ArrowUp'    || e.key === 'd') doAction('defer');
  });

  // -- Register service worker --
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // -- Init --
  loadSuggestions();
  flushPendingActions();
})();
