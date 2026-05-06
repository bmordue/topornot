(() => {
  'use strict';

  // -- State --
  let suggestions = [];
  let currentIndex = 0;
  let processing = false;
  let loading = false;

  // -- DOM refs --
  const cardEl       = document.getElementById('current-card');
  const loadingEl    = document.getElementById('loading-state');
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
  const hintApprove  = document.getElementById('hint-approve');
  const hintReject   = document.getElementById('hint-reject');
  const hintDefer    = document.getElementById('hint-defer');

  function flashButton(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('pressed');
    setTimeout(() => el.classList.remove('pressed'), 150);
  }

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
  offlineBanner.setAttribute('role', 'status');
  offlineBanner.setAttribute('aria-live', 'polite');
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
    if (loading) {
      loadingEl.hidden = false;
      cardEl.hidden = true;
      actionBar.hidden = true;
      emptyEl.hidden = true;
      return;
    }
    loadingEl.hidden = true;

    // API already returns only pending suggestions by default, and we remove items
    // from this array in doAction() as they are approved/rejected.
    const pendingCount = suggestions.length;

    queueCount.textContent = `${pendingCount} pending`;
    document.title = pendingCount > 0 ? `(${pendingCount}) topornot` : 'topornot';

    if (pendingCount === 0) {
      cardEl.hidden = true;
      actionBar.hidden = true;
      emptyEl.hidden = false;
      document.getElementById('btn-refresh').focus();
      return;
    }

    emptyEl.hidden = true;
    cardEl.hidden = false;
    actionBar.hidden = false;

    const s = suggestions[currentIndex % pendingCount];

    cardAgent.textContent = s.agent || 'agent';
    cardTime.textContent  = relativeTime(s.created_at);
    // suggestions.json dates are 'YYYY-MM-DD HH:mm:ss' without TZ, assume UTC
    const dateStr = s.created_at.includes('Z') ? s.created_at : s.created_at.replace(' ', 'T') + 'Z';
    const date = new Date(dateStr);
    cardTime.title = isNaN(date) ? '' : date.toLocaleString();
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
    // Performance: Immediate cache-first load to eliminate loading screen
    try {
      suggestions = JSON.parse(localStorage.getItem('cachedSuggestions') || '[]');
    } catch {
      suggestions = [];
    }

    // Show whatever we have immediately
    if (suggestions.length > 0) {
      loading = false;
      renderCard();
    } else {
      loading = true;
      renderCard();
    }

    try {
      const etag = localStorage.getItem('suggestionsEtag');
      const headers = etag ? { 'If-None-Match': etag } : {};
      const res = await fetch('/api/suggestions', { headers });

      if (res.status === 304) {
        // Performance: Data hasn't changed, skip parsing and re-rendering.
        // We already rendered the cached data above.
        loading = false;
        return;
      }

      if (!res.ok) throw new Error('Network error');

      suggestions = await res.json();
      const newEtag = res.headers.get('ETag');

      localStorage.setItem('cachedSuggestions', JSON.stringify(suggestions));
      if (newEtag) localStorage.setItem('suggestionsEtag', newEtag);
      currentIndex = 0;
    } catch (err) {
      console.warn('Sync failed, using cached data:', err);
    }

    loading = false;
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
  const refreshHandler = async () => {
    showToast('Refreshing...');
    const refreshIcons = document.querySelectorAll('.refresh-icon');
    refreshIcons.forEach(icon => icon.classList.add('spinning'));
    await loadSuggestions();
    // Small delay to ensure animation is visible if load is near-instant
    setTimeout(() => {
      refreshIcons.forEach(icon => icon.classList.remove('spinning'));
      showToast('Queue up to date');
    }, 400);
  };

  document.getElementById('btn-approve').addEventListener('click', () => doAction('approve'));
  document.getElementById('btn-reject').addEventListener('click',  () => doAction('reject'));
  document.getElementById('btn-defer').addEventListener('click',   () => doAction('defer'));
  document.getElementById('btn-refresh').addEventListener('click', refreshHandler);
  document.getElementById('btn-header-refresh').addEventListener('click', refreshHandler);

  // -- Swipe gestures --
  let touchStartX = 0;
  let touchStartY = 0;
  let lastDX = 0;
  let lastDY = 0;
  let isDragging  = false;
  let ticking = false;

  function updateSwipe() {
    if (!isDragging) {
      ticking = false;
      return;
    }

    // Tilt the card slightly as user swipes
    cardEl.style.transform = `translateX(${lastDX * 0.4}px) translateY(${lastDY * 0.4}px) rotate(${lastDX * 0.03}deg)`;

    // Show swipe hints
    const THRESHOLD = 60;
    hintApprove.style.opacity = lastDX > THRESHOLD ? Math.min((lastDX - THRESHOLD) / 40, 1) : 0;
    hintReject.style.opacity  = lastDX < -THRESHOLD ? Math.min((-lastDX - THRESHOLD) / 40, 1) : 0;
    hintDefer.style.opacity   = lastDY < -THRESHOLD ? Math.min((-lastDY - THRESHOLD) / 40, 1) : 0;

    ticking = false;
  }

  cardEl.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    isDragging = true;
  }, { passive: true });

  cardEl.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    lastDX = e.touches[0].clientX - touchStartX;
    lastDY = e.touches[0].clientY - touchStartY;

    if (!ticking) {
      requestAnimationFrame(updateSwipe);
      ticking = true;
    }
  }, { passive: true });

  cardEl.addEventListener('touchend', (e) => {
    if (!isDragging) return;
    isDragging = false;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    cardEl.style.transform = '';
    hintApprove.style.opacity = 0;
    hintReject.style.opacity  = 0;
    hintDefer.style.opacity   = 0;

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
    const key = e.key.toLowerCase();
    if (key === 'arrowright' || key === 'a') {
      flashButton('btn-approve');
      doAction('approve');
    }
    if (key === 'arrowleft'  || key === 'z') {
      flashButton('btn-reject');
      doAction('reject');
    }
    if (key === 'arrowup'    || key === 'd') {
      flashButton('btn-defer');
      doAction('defer');
    }
    if (key === 'r') {
      flashButton(emptyEl.hidden ? 'btn-header-refresh' : 'btn-refresh');
      refreshHandler();
    }
    if (key === 'c') {
      flashButton('card-context-summary');
      const details = cardCtxWrap.querySelector('details');
      if (details) details.open = !details.open;
    }
  });

  // -- Register service worker --
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // -- Init --
  loadSuggestions();
  flushPendingActions();
})();
