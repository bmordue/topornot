(() => {
  'use strict';

  // -- State --
  let suggestions = [];
  let lastCount = -1;
  let currentIndex = 0;
  let processing = false;
  let loading = false;

  // Performance: Track reduced motion preference to skip animations/delays
  let prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', e => {
    prefersReducedMotion = e.matches;
  });

  // -- DOM refs --
  const cardStack    = document.getElementById('card-stack');
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
  const cardCtxDetails = cardCtxWrap.querySelector('details');
  const cardCtx      = document.getElementById('card-context');
  const cardPos      = document.getElementById('card-pos');
  const cardProgress = document.getElementById('card-progress');
  const toastEl      = document.getElementById('toast');
  const hintApprove  = document.getElementById('hint-approve');
  const hintReject   = document.getElementById('hint-reject');
  const hintDefer    = document.getElementById('hint-defer');

  const btnApprove   = document.getElementById('btn-approve');
  const btnReject    = document.getElementById('btn-reject');
  const btnDefer     = document.getElementById('btn-defer');

  function showHelp() {
    if (navigator.vibrate) navigator.vibrate(10);
    showToast('Shortcuts: A/Enter/→: Approve, Z/←: Reject, D/↑: Defer, R: Refresh, C: Context, S: Copy, Esc: Close toast/context, ?, /: Help', 'info', 6000);
  }

  function flashButton(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const isAction = ['btn-approve', 'btn-reject', 'btn-defer'].includes(id);
    const cls = isAction ? 'btn-active-threshold' : 'pressed';
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 150);
  }

  // -- Toast --
  let toastTimer;
  function showToast(msg, type = 'info', duration = 2200) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.remove('toast-approve', 'toast-reject', 'toast-defer', 'toast-info');
    toastEl.classList.add('show', `toast-${type}`);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
  }

  // -- Offline banner --
  const offlineBanner = document.createElement('div');
  offlineBanner.className = 'offline-banner';
  offlineBanner.setAttribute('role', 'status');
  offlineBanner.setAttribute('aria-live', 'polite');
  offlineBanner.textContent = '⚠ You are offline. Actions will sync when reconnected.';
  const skipLink = document.querySelector('.skip-link');
  if (skipLink) skipLink.after(offlineBanner);
  else document.body.prepend(offlineBanner);

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
  // Performance: Lazy date parsing and memoization helper.
  // Avoids O(N) parsing overhead at startup for large datasets.
  function getSuggestionDate(s) {
    if (!s._date) {
      const dateStr = s.created_at.includes('Z') ? s.created_at : s.created_at.replace(' ', 'T') + 'Z';
      s._date = new Date(dateStr);
    }
    return s._date;
  }

  // Performance: Accept a Date object instead of a string to avoid redundant parsing.
  function relativeTime(date) {
    const diff = Date.now() - date.getTime();
    // Performance: Fast-path for recent items to avoid division/floor operations.
    if (diff < 60000) return 'just now';
    const m = Math.floor(diff / 60000);
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

    if (lastCount !== -1 && pendingCount !== lastCount) {
      queueCount.classList.remove('pulse-subtle');
      void queueCount.offsetWidth;
      queueCount.classList.add('pulse-subtle');
      setTimeout(() => queueCount.classList.remove('pulse-subtle'), 400);
    }
    lastCount = pendingCount;

    queueCount.textContent = `${pendingCount} pending`;
    document.title = pendingCount > 0 ? `(${pendingCount}) topornot` : '✓ All clear - topornot';

    if (pendingCount === 0) {
      if (cardStack) cardStack.classList.remove('has-next', 'has-many');
      cardEl.hidden = true;
      actionBar.hidden = true;
      emptyEl.hidden = false;
      document.getElementById('btn-refresh').focus();
      return;
    }

    if (cardStack) {
      cardStack.classList.toggle('has-next', pendingCount > 1);
      cardStack.classList.toggle('has-many', pendingCount > 2);
    }

    emptyEl.hidden = true;
    cardEl.hidden = false;
    actionBar.hidden = false;

    // Reset animation
    cardEl.classList.remove('slideIn');
    void cardEl.offsetWidth;
    cardEl.classList.add('slideIn');

    // Programmatic focus for screen readers
    cardTitle.focus();

    // Reset details expansion state
    if (cardCtxDetails) cardCtxDetails.open = false;

    const s = suggestions[currentIndex % pendingCount];
    const date = getSuggestionDate(s);

    cardAgent.textContent = s.agent || 'agent';
    cardTime.textContent  = relativeTime(date);
    cardTime.title = isNaN(date) ? '' : date.toLocaleString();
    if (!isNaN(date)) cardTime.setAttribute('datetime', date.toISOString());
    cardTitle.textContent = s.title;
    cardDesc.textContent  = s.description;

    if (s.context) {
      cardCtx.textContent = s.context;
      cardCtxWrap.hidden = false;
    } else {
      cardCtxWrap.hidden = true;
    }

    const currentPos = (currentIndex % pendingCount) + 1;
    cardPos.textContent = `${currentPos} of ${pendingCount}`;
    cardPos.setAttribute('aria-label', `Suggestion ${currentPos} of ${pendingCount}`);
    const progressPercent = Math.round((currentPos / pendingCount) * 100);
    cardProgress.style.width = `${progressPercent}%`;
    cardProgress.setAttribute('aria-valuenow', progressPercent);
    cardProgress.setAttribute('aria-valuetext', `Item ${currentPos} of ${pendingCount}`);
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

      const text = await res.text();
      suggestions = JSON.parse(text);
      const newEtag = res.headers.get('ETag');

      localStorage.setItem('cachedSuggestions', text);
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

    if (navigator.vibrate) navigator.vibrate(10);
    processing = true;
    const s = suggestions[currentIndex % suggestions.length];
    const suggestionTitle = s.title || '';

    // Animate card out
    const animClass = action === 'approve' ? 'exiting-approve' :
                      action === 'reject'  ? 'exiting-reject'  : 'exiting-defer';
    cardEl.classList.add(animClass);

    // Performance: Skip animation delay if user prefers reduced motion.
    // Saves 320ms of execution time per card action.
    if (!prefersReducedMotion) {
      await new Promise(r => setTimeout(r, 320));
    }
    cardEl.classList.remove(animClass);

    // Optimistic update for defer: it stays pending, just move to next
    if (action === 'defer') {
      currentIndex = (currentIndex + 1) % Math.max(suggestions.length, 1);
      showToast(`Deferred: ${truncate(suggestionTitle)}`, 'defer');
    } else {
      // Optimistically remove from pending view by updating suggestions array
      const sIdx = currentIndex % suggestions.length;
      suggestions.splice(sIdx, 1);

      if (suggestions.length === 0 || currentIndex >= suggestions.length) {
        currentIndex = 0;
      }
      if (suggestions.length === 0) {
        showToast('🎉 All caught up!', 'info', 3000);
        if (navigator.vibrate) navigator.vibrate([50, 30, 50, 30, 80]);
      } else {
        const prefix = action === 'approve' ? '✓ Approved' : '✗ Rejected';
        showToast(`${prefix}: ${truncate(suggestionTitle)}`, action);
      }
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

  // -- Copy functionality --
  function copyToClipboard() {
    const s = suggestions[currentIndex % suggestions.length];
    if (!s) return;
    const btn = document.getElementById('btn-copy');
    const label = btn.querySelector('.btn-label');
    const icon = btn.querySelector('.btn-icon');
    const originalLabel = label.innerHTML;
    const originalIcon = icon.textContent;

    const text = `Suggestion from ${s.agent || 'agent'}:\n\n${s.title}\n${s.description}${s.context ? '\n\nContext:\n' + s.context : ''}`;
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied to clipboard', 'info');
      if (navigator.vibrate) navigator.vibrate(10);

      label.textContent = 'Copied!';
      icon.textContent = '✓';
      setTimeout(() => {
        label.innerHTML = originalLabel;
        icon.textContent = originalIcon;
      }, 1500);
    }).catch(err => {
      console.error('Failed to copy: ', err);
      showToast('Copy failed', 'reject');
    });
  }

  // -- Button handlers --
  const refreshHandler = async () => {
    if (navigator.vibrate) navigator.vibrate(10);
    showToast('Refreshing...', 'info');
    const refreshIcons = document.querySelectorAll('.refresh-icon');
    refreshIcons.forEach(icon => icon.classList.add('spinning'));
    await loadSuggestions();
    // Small delay to ensure animation is visible if load is near-instant
    setTimeout(() => {
      refreshIcons.forEach(icon => icon.classList.remove('spinning'));
      showToast('Queue up to date', 'info');
    }, 400);
  };

  document.getElementById('btn-approve').addEventListener('click', () => doAction('approve'));
  document.getElementById('btn-reject').addEventListener('click',  () => doAction('reject'));
  document.getElementById('btn-defer').addEventListener('click',   () => doAction('defer'));
  document.getElementById('btn-copy').addEventListener('click',    () => {
    flashButton('btn-copy');
    copyToClipboard();
  });
  document.getElementById('btn-refresh').addEventListener('click', refreshHandler);
  document.getElementById('btn-header-refresh').addEventListener('click', refreshHandler);
  document.getElementById('btn-header-help').addEventListener('click', () => {
    flashButton('btn-header-help');
    showHelp();
  });
  const cardSummary = cardCtxDetails ? cardCtxDetails.querySelector('summary') : null;
  if (cardSummary) {
    cardSummary.addEventListener('click', () => {
      if (navigator.vibrate) navigator.vibrate(10);
    });
  }
  toastEl.addEventListener('click', () => {
    clearTimeout(toastTimer);
    toastEl.classList.remove('show');
  });

  // -- Swipe gestures --
  let touchStartX = 0;
  let touchStartY = 0;
  let lastDX = 0;
  let lastDY = 0;
  let isDragging  = false;
  let ticking = false;
  let thresholdReached = false;

  function updateSwipe() {
    if (!isDragging) {
      ticking = false;
      return;
    }

    // Tilt the card slightly as user swipes
    cardEl.style.transform = `translateX(${lastDX * 0.4}px) translateY(${lastDY * 0.4}px) rotate(${lastDX * 0.03}deg)`;

    // Show swipe hints
    const THRESHOLD = 60;
    const ACTION_THRESHOLD = 80;
    hintApprove.style.opacity = lastDX > THRESHOLD ? Math.min((lastDX - THRESHOLD) / 40, 1) : 0;
    hintReject.style.opacity  = lastDX < -THRESHOLD ? Math.min((-lastDX - THRESHOLD) / 40, 1) : 0;
    hintDefer.style.opacity   = lastDY < -THRESHOLD ? Math.min((-lastDY - THRESHOLD) / 40, 1) : 0;

    // Threshold state feedback
    let activeThreshold = null;
    if (Math.abs(lastDX) > Math.abs(lastDY)) {
      if (lastDX > ACTION_THRESHOLD)       activeThreshold = 'threshold-approve';
      else if (lastDX < -ACTION_THRESHOLD) activeThreshold = 'threshold-reject';
    } else {
      if (lastDY < -ACTION_THRESHOLD)      activeThreshold = 'threshold-defer';
    }

    if (activeThreshold && !cardEl.classList.contains(activeThreshold)) {
      cardEl.classList.remove('threshold-approve', 'threshold-reject', 'threshold-defer');
      cardEl.classList.add(activeThreshold);

      // Sync button feedback
      btnApprove.classList.remove('btn-active-threshold');
      btnReject.classList.remove('btn-active-threshold');
      btnDefer.classList.remove('btn-active-threshold');
      if (activeThreshold === 'threshold-approve') btnApprove.classList.add('btn-active-threshold');
      if (activeThreshold === 'threshold-reject')  btnReject.classList.add('btn-active-threshold');
      if (activeThreshold === 'threshold-defer')   btnDefer.classList.add('btn-active-threshold');

      if (navigator.vibrate) navigator.vibrate(10);
      thresholdReached = true;
    } else if (!activeThreshold && thresholdReached) {
      cardEl.classList.remove('threshold-approve', 'threshold-reject', 'threshold-defer');
      btnApprove.classList.remove('btn-active-threshold');
      btnReject.classList.remove('btn-active-threshold');
      btnDefer.classList.remove('btn-active-threshold');
      thresholdReached = false;
    }

    ticking = false;
  }

  cardEl.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    isDragging = true;
    cardEl.classList.add('dragging');
    thresholdReached = false;
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
    cardEl.classList.remove('dragging', 'threshold-approve', 'threshold-reject', 'threshold-defer');
    btnApprove.classList.remove('btn-active-threshold');
    btnReject.classList.remove('btn-active-threshold');
    btnDefer.classList.remove('btn-active-threshold');

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

  cardEl.addEventListener('touchcancel', () => {
    isDragging = false;
    cardEl.classList.remove('dragging', 'threshold-approve', 'threshold-reject', 'threshold-defer');
    btnApprove.classList.remove('btn-active-threshold');
    btnReject.classList.remove('btn-active-threshold');
    btnDefer.classList.remove('btn-active-threshold');
    cardEl.style.transform = '';
    hintApprove.style.opacity = 0;
    hintReject.style.opacity  = 0;
    hintDefer.style.opacity   = 0;
  }, { passive: true });

  // -- Keyboard shortcuts (desktop) --
  document.addEventListener('keydown', (e) => {
    // Safeguard: Don't trigger shortcuts if user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    // Ignore if a modifier key is held (e.g. Ctrl+R)
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key.toLowerCase();
    if (key === 'arrowright' || key === 'a' || (key === 'enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SUMMARY')) {
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
      if (navigator.vibrate) navigator.vibrate(10);
      flashButton('card-context-summary');
      if (cardCtxDetails) {
        cardCtxDetails.open = !cardCtxDetails.open;
        if (cardCtxDetails.open) {
          // Performance: Use instant scroll if user prefers reduced motion.
          // Eliminates ~300ms scroll animation latency.
          const behavior = prefersReducedMotion ? 'auto' : 'smooth';
          setTimeout(() => cardCtxDetails.scrollIntoView({ behavior, block: 'nearest' }), 50);
        }
      }
    }
    if (key === 'escape') {
      let handled = false;
      if (toastEl.classList.contains('show')) {
        clearTimeout(toastTimer);
        toastEl.classList.remove('show');
        handled = true;
      }
      if (cardCtxDetails && cardCtxDetails.open) {
        cardCtxDetails.open = false;
        handled = true;
      }
      if (handled && navigator.vibrate) navigator.vibrate(10);
    }
    if (key === 's') {
      flashButton('btn-copy');
      copyToClipboard();
    }
    if (key === '?' || key === '/') {
      flashButton('btn-header-help');
      showHelp();
    }
  });

  // -- Live relative time updates --
  // Performance: Use Visibility API to pause updates when tab is in background.
  let updateTimer;
  function startUpdateTimer() {
    if (updateTimer) return;
    updateTimer = setInterval(() => {
      if (suggestions.length === 0) return;
      const s = suggestions[currentIndex % suggestions.length];
      // Performance: Use lazy getSuggestionDate() to avoid redundant parsing and fix runtime bug.
      if (s && !cardEl.hidden) {
        cardTime.textContent = relativeTime(getSuggestionDate(s));
      }
    }, 60000);
  }

  function stopUpdateTimer() {
    clearInterval(updateTimer);
    updateTimer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopUpdateTimer();
    else startUpdateTimer();
  });

  if (!document.hidden) startUpdateTimer();

  // -- Register service worker --
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // -- Truncate helper --
  function truncate(str, max = 40) {
    if (!str || str.length <= max) return str;
    return str.substring(0, max - 3) + '...';
  }

  // -- Init --
  loadSuggestions();
  flushPendingActions();
})();
