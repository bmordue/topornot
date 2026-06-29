(() => {
  'use strict';

  // -- State --
  let suggestions = [];
  let lastCount = -1;
  let currentIndex = 0;
  let processing = false;
  let loading = false;
  let lastAction = null;
  let sessionCount = parseInt(sessionStorage.getItem('sessionCount') || '0', 10);
  let sessionApproved = parseInt(sessionStorage.getItem('sessionApproved') || '0', 10);
  let sessionRejected = parseInt(sessionStorage.getItem('sessionRejected') || '0', 10);

  // Performance: Use Symbols for internal UI state to avoid leaking memoized
  // properties into localStorage serialization (bloat and deserialization bugs).
  const SYM_DATE      = Symbol('date');
  const SYM_LOCAL     = Symbol('local');
  const SYM_ISO       = Symbol('iso');
  const SYM_HTML_DESC = Symbol('htmlDesc');
  const SYM_HTML_CTX  = Symbol('htmlCtx');

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
  const emptyIcon    = emptyEl.querySelector('.empty-icon');
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

  // Performance: Hoist regular expressions to avoid redundant compilation in every linkify call.
  // We match http/https URLs and stop at common delimiters.
  // Security: Use a negative lookahead to prevent matching across escaped HTML entities like &quot;
  // which would otherwise allow XSS attribute breakout in href.
  const URL_REGEX = /https?:\/\/(?:(?!&(?:quot|#39);)[^\s<"'])+/g;
  const TRAILING_PUNCTUATION = /[.,;:]+$/;

  // Performance: Hoist Markdown regexes to avoid redundant compilation in every linkify call.
  const MD_CODE_REGEX = /`([^`]+)`/g;
  const MD_BOLD_REGEX = /\*\*([^*]+)\*\*/g;
  const MD_ITALIC_REGEX = /(\*|_)([^*_]+)\1/g;
  const MD_STRIKE_REGEX = /~~([^~]+)~~/g;
  const MD_LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/(?:(?!&(?:quot|#39);)[^\s<"'])+)\)/g;
  // Performance: Hoist the restoration regex for Markdown link placeholders.
  const MD_RESTORE_REGEX = /__MD_LINK_(\d+)__/g;

  // Performance: High-performance string-based escaping.
  // Significantly faster than creating a DOM element (document.createElement('div'))
  // and setting textContent on every render.
  const ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  const ESCAPE_REGEX = /[&<>"']/g;
  const ESCAPE_TEST_REGEX = /[&<>"']/;
  function escapeHTML(text) {
    // Performance: Fast-path for clean strings (test() is faster than replace() and avoids new string allocation).
    return ESCAPE_TEST_REGEX.test(text) ? text.replace(ESCAPE_REGEX, s => ESCAPE_MAP[s]) : text;
  }

  function showHelp() {
    if (navigator.vibrate) navigator.vibrate(10);
    const helpHtml = `
      <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:10px;text-align:left;font-size:0.8rem;">
        <div><kbd aria-hidden="true">A</kbd> <kbd aria-hidden="true">Enter</kbd> <kbd aria-hidden="true">→</kbd> Approve</div>
        <div><kbd aria-hidden="true">Z</kbd> <kbd aria-hidden="true">X</kbd> <kbd aria-hidden="true">←</kbd> Reject</div>
        <div><kbd aria-hidden="true">D</kbd> <kbd aria-hidden="true">↑</kbd> Defer</div>
        <div><kbd aria-hidden="true">C</kbd> <kbd aria-hidden="true">↓</kbd> Context / <kbd aria-hidden="true">S</kbd> Copy</div>
        <div><kbd aria-hidden="true">U</kbd> Undo / <kbd aria-hidden="true">R</kbd> Refresh</div>
        <div><kbd aria-hidden="true">?</kbd> <kbd aria-hidden="true">/</kbd> <kbd aria-hidden="true">H</kbd> Help</div>
        <div><kbd aria-hidden="true">Esc</kbd> Close</div>
        <div style="grid-column: span 2; border-top: 1px solid color-mix(in srgb, currentColor, transparent 85%); padding-top: 8px; margin-top: 4px; font-style: italic;">
          Gestures: Swipe Right (Approve), Left (Reject), Up (Defer)
        </div>
      </div>
    `;
    showToast(helpHtml, 'info', 10000, true);
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
  let toastRemaining = 0;
  let toastStartTime = 0;
  function showToast(msg, type = 'info', duration = 3000, isHTML = false) {
    clearTimeout(toastTimer);
    toastRemaining = duration;
    toastStartTime = Date.now();

    if (isHTML) {
      toastEl.innerHTML = msg;
    } else {
      toastEl.textContent = msg;
    }

    toastEl.classList.remove('toast-approve', 'toast-reject', 'toast-defer', 'toast-info', 'toast-has-timer');
    toastEl.classList.add('show', `toast-${type}`);

    // Performance: Avoid setTimeout if duration is 0 (keep shown until interaction)
    if (duration > 0) {
      toastEl.style.setProperty('--duration', `${duration}ms`);
      toastEl.classList.add('toast-has-timer');
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
    }
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
        if (res.status === 401) {
          clearLocalState();
          renderCard();
          return;
        }
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
  /**
   * Returns the parsed Date object for a suggestion, memoizing the result
   * and its expensive string representations for better performance.
   */
  function getSuggestionDate(s) {
    if (!s[SYM_DATE]) {
      const dateStr = s.created_at.includes('Z') ? s.created_at : s.created_at.replace(' ', 'T') + 'Z';
      const d = new Date(dateStr);
      s[SYM_DATE] = d;
      // Performance: Memoize expensive formatting results on the first call.
      // This eliminates redundant work during frequent card renders.
      const isValid = !isNaN(d);
      s[SYM_LOCAL] = isValid ? d.toLocaleString() : '';
      s[SYM_ISO] = isValid ? d.toISOString() : '';
    }
    return s[SYM_DATE];
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

    const doneText = sessionCount > 0 ? ` · ${sessionCount} reviewed` : '';
    queueCount.textContent = `${pendingCount} pending${doneText}`;

    if (pendingCount === 0) {
      document.title = '✓ All clear - topornot';
      if (cardStack) cardStack.classList.remove('has-next', 'has-many');
      cardEl.hidden = true;
      actionBar.hidden = true;
      emptyEl.hidden = false;

      // Randomize celebratory icon and message
      const icons = ['✓', '🎉', '✨', '🥳', '🏆'];
      const messages = ['All caught up!', 'Queue cleared!', 'Great work!', 'Everything reviewed!'];
      const iconEl = emptyEl.querySelector('.empty-icon');
      const msgEl = emptyEl.querySelector('p');
      if (iconEl) iconEl.textContent = icons[Math.floor(Math.random() * icons.length)];
      if (msgEl) msgEl.textContent = messages[Math.floor(Math.random() * messages.length)];

      const statsEl = document.getElementById('session-stats');
      if (statsEl) {
        if (sessionCount > 0) {
          // Accessibility: Improve discoverability with title
          const undoHtml = lastAction ? `<button class="undo-btn" id="btn-empty-undo" aria-keyshortcuts="U" title="Undo (U)">Undo last action <kbd>U</kbd></button>` : '';
          statsEl.innerHTML = `
            <div>You've reviewed ${sessionCount} item${sessionCount === 1 ? '' : 's'} this session:</div>
            <div style="display: flex; gap: 8px; justify-content: center;">
              <span class="card-agent" style="background: var(--color-approve);" aria-label="${sessionApproved} approved">✓ ${sessionApproved}</span>
              <span class="card-agent" style="background: var(--color-reject);" aria-label="${sessionRejected} rejected">✗ ${sessionRejected}</span>
            </div>
            ${undoHtml}
          `;
        } else {
          statsEl.innerHTML = '';
        }
      }

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
    // Performance: Use memoized date strings to avoid redundant O(N) formatting.
    cardTime.title = s[SYM_LOCAL];
    if (s[SYM_ISO]) cardTime.setAttribute('datetime', s[SYM_ISO]);
    cardTitle.textContent = s.title;

    // Performance: Memoize linkified HTML on the suggestion object to eliminate
    // redundant processing and regex scanning on subsequent renders of the same card.
    if (!s[SYM_HTML_DESC]) s[SYM_HTML_DESC] = linkify(s.description);
    cardDesc.innerHTML = s[SYM_HTML_DESC];

    if (s.context) {
      if (!s[SYM_HTML_CTX]) s[SYM_HTML_CTX] = linkify(s.context);
      cardCtx.innerHTML = s[SYM_HTML_CTX];
      cardCtxWrap.hidden = false;
    } else {
      cardCtxWrap.hidden = true;
    }

    const currentPos = (currentIndex % pendingCount) + 1;
    document.title = `(${currentPos}/${pendingCount}) topornot`;
    cardPos.textContent = `${currentPos} of ${pendingCount}`;
    cardPos.setAttribute('aria-label', `Suggestion ${currentPos} of ${pendingCount}`);
    const progressPercent = Math.round((currentPos / pendingCount) * 100);
    cardProgress.style.width = `${progressPercent}%`;
    cardProgress.setAttribute('aria-valuenow', progressPercent);
    cardProgress.setAttribute('aria-valuetext', `Item ${currentPos} of ${pendingCount}`);
  }

  /**
   * Security: Clears local cache and session state on authentication failure.
   * Prevents leaking sensitive suggestion data from previous sessions on shared devices.
   */
  function clearLocalState() {
    localStorage.removeItem('cachedSuggestions');
    localStorage.removeItem('suggestionsEtag');
    localStorage.removeItem('pendingActions');
    sessionStorage.removeItem('sessionCount');
    sessionStorage.removeItem('sessionApproved');
    sessionStorage.removeItem('sessionRejected');
    suggestions = [];
    sessionCount = 0;
    sessionApproved = 0;
    sessionRejected = 0;
    currentIndex = 0;
    lastAction = null;
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

      if (res.status === 401) {
        // Security: Clear cache if unauthorized to prevent leaking data to different users.
        clearLocalState();
        loading = false;
        renderCard();
        return;
      }

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
      lastAction = null;
    } catch (err) {
      console.warn('Sync failed, using cached data:', err);
    }

    loading = false;
    renderCard();
  }

  // -- Perform action --
  async function undoLastAction() {
    if (!lastAction || processing) return;
    const { suggestion, action, index } = lastAction;
    lastAction = null; // Clear to prevent double undo

    if (navigator.vibrate) navigator.vibrate(10);
    processing = true;

    // Local state restoration
    if (action !== 'defer') {
      suggestions.splice(index, 0, suggestion);
      sessionCount = Math.max(0, sessionCount - 1);
      sessionStorage.setItem('sessionCount', sessionCount);
      if (action === 'approve') {
        sessionApproved = Math.max(0, sessionApproved - 1);
        sessionStorage.setItem('sessionApproved', sessionApproved);
      } else if (action === 'reject') {
        sessionRejected = Math.max(0, sessionRejected - 1);
        sessionStorage.setItem('sessionRejected', sessionRejected);
      }
      currentIndex = index;
    } else {
      // For defer, we just moved the pointer, so move it back
      currentIndex = (currentIndex - 1 + suggestions.length) % suggestions.length;
    }

    showToast('Action undone', 'info');
    renderCard();
    processing = false;

    // Sync with server: revert to pending
    if (navigator.onLine) {
      try {
        await fetch(`/api/suggestions/${suggestion.id}/defer`, { method: 'PATCH' });
        // The endpoint 'defer' sets status back to 'pending'
      } catch (err) {
        console.warn('Undo sync failed:', err);
      }
    }
  }

  async function doAction(action) {
    if (processing) return;
    if (!suggestions.length) return;

    if (navigator.vibrate) navigator.vibrate(10);
    processing = true;
    const currentIdx = currentIndex % suggestions.length;
    const s = suggestions[currentIdx];
    const suggestionTitle = s.title || '';

    // Store for undo
    lastAction = {
      suggestion: s,
      action: action,
      index: currentIdx
    };

    // Animate card out
    const animClass = action === 'approve' ? 'exiting-approve' :
                      action === 'reject'  ? 'exiting-reject'  : 'exiting-defer';
    cardEl.classList.add(animClass);

    // Show the corresponding hint to provide visual confirmation for non-swipe actions
    const hint = action === 'approve' ? hintApprove :
                 action === 'reject'  ? hintReject : hintDefer;
    if (hint) hint.style.opacity = '1';

    // Performance: Skip animation delay if user prefers reduced motion.
    // Saves 320ms of execution time per card action.
    if (!prefersReducedMotion) {
      await new Promise(r => setTimeout(r, 320));
    }
    cardEl.classList.remove(animClass);
    if (hint) hint.style.opacity = '0';

    // Optimistic update for defer: it stays pending, just move to next
    if (action === 'defer') {
      currentIndex = (currentIndex + 1) % Math.max(suggestions.length, 1);
    } else {
      // Optimistically remove from pending view by updating suggestions array
      suggestions.splice(currentIndex % suggestions.length, 1);

      if (suggestions.length === 0 || currentIndex >= suggestions.length) {
        currentIndex = 0;
      }

      sessionCount++;
      sessionStorage.setItem('sessionCount', sessionCount);
      if (action === 'approve') {
        sessionApproved++;
        sessionStorage.setItem('sessionApproved', sessionApproved);
      } else if (action === 'reject') {
        sessionRejected++;
        sessionStorage.setItem('sessionRejected', sessionRejected);
      }
    }

    if (suggestions.length === 0) {
      showToast('🎉 All caught up! <button class="undo-btn" aria-keyshortcuts="U" title="Undo (U)" aria-label="Undo last action">Undo <kbd aria-hidden="true">U</kbd></button>', 'info', 5000, true);
      if (navigator.vibrate) navigator.vibrate([50, 30, 50, 30, 80]);
    } else {
      const suffix = ` (${suggestions.length} left)`;
      const prefix = action === 'approve' ? '✓ Approved' :
                     action === 'reject'  ? '✗ Rejected'  : '↩ Deferred';
      // Performance: Use high-performance escapeHTML instead of DOM-based escaping.
      // Safety: Escape title before including in HTML toast
      const escapedTitle = escapeHTML(truncate(suggestionTitle));
      showToast(`${prefix}: ${escapedTitle}${suffix} <button class="undo-btn" aria-keyshortcuts="U" title="Undo (U)" aria-label="Undo last action">Undo <kbd aria-hidden="true">U</kbd></button>`, action, 3000, true);
    }

    renderCard();
    processing = false;

    // Sync with server
    if (navigator.onLine) {
      try {
        const res = await fetch(`/api/suggestions/${s.id}/${action}`, { method: 'PATCH' });
        if (res.status === 401) {
          // Security: Clear cache if unauthorized.
          clearLocalState();
          renderCard();
          return;
        }
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
      showToast(`📋 Copied: ${truncate(s.title)}`, 'info');
      if (navigator.vibrate) navigator.vibrate(10);

      label.textContent = 'Copied!';
      icon.textContent = '✓';
      btn.classList.add('btn-success');
      setTimeout(() => {
        label.innerHTML = originalLabel;
        icon.textContent = originalIcon;
        btn.classList.remove('btn-success');
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
  emptyEl.addEventListener('click', (e) => {
    if (e.target.closest('.undo-btn')) {
      undoLastAction();
    }
  });
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
  toastEl.addEventListener('click', (e) => {
    // Check if the click was on the undo button or any of its children (like <kbd aria-hidden="true">)
    const undoBtn = e.target.closest('.undo-btn');
    if (undoBtn) {
      undoLastAction();
      return; // Don't dismiss, let undoLastAction's showToast handle the new state
    }
    clearTimeout(toastTimer);
    toastEl.classList.remove('show');
  });
  toastEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toastEl.click();
    }
  });

  const pauseToast = () => {
    if (!toastEl.classList.contains('show') || toastRemaining <= 0) return;
    clearTimeout(toastTimer);
    toastRemaining -= (Date.now() - toastStartTime);
  };

  const resumeToast = () => {
    if (!toastEl.classList.contains('show') || toastRemaining <= 0) return;
    clearTimeout(toastTimer);
    toastStartTime = Date.now();
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show', 'toast-approve', 'toast-reject', 'toast-defer', 'toast-info', 'toast-has-timer');
    }, toastRemaining);
  };
  toastEl.addEventListener('mouseenter', pauseToast);
  toastEl.addEventListener('focusin', pauseToast);
  toastEl.addEventListener('mouseleave', resumeToast);
  toastEl.addEventListener('focusout', resumeToast);

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
    if (key === 'arrowright' || key === 'a' || (key === 'enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SUMMARY' && e.target.tagName !== 'A')) {
      flashButton('btn-approve');
      doAction('approve');
    }
    if (key === 'arrowleft'  || key === 'z' || key === 'x') {
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
    if (key === 'c' || key === 'arrowdown') {
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
    if (key === '?' || key === '/' || key === 'h') {
      flashButton('btn-header-help');
      showHelp();
    }
    if (key === 'u') {
      undoLastAction();
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

  // -- Linkify helper --
  /**
   * Converts URLs in text to clickable links and adds basic formatting.
   * Performance: Uses string-based escaping, hoisted regexes, and a fast-path for plain content.
   */
  function linkify(text) {
    if (!text) return '';

    // Performance: Fast-path for strings that do not contain URLs or formatting.
    if (!text.includes('http') && !text.includes('`') && !text.includes('*') && !text.includes('_') && !text.includes('~') && !text.includes('[')) {
      return escapeHTML(text);
    }

    // Security: Escape HTML first to prevent XSS.
    let html = escapeHTML(text);

    // Support for inline code: `code`
    html = html.replace(MD_CODE_REGEX, '<code>$1</code>');

    // Support for bold: **bold**
    html = html.replace(MD_BOLD_REGEX, '<strong>$1</strong>');

    // Support for italic: *italic* or _italic_
    html = html.replace(MD_ITALIC_REGEX, '<em>$2</em>');

    // Support for strikethrough: ~~strikethrough~~
    html = html.replace(MD_STRIKE_REGEX, '<s>$1</s>');

    // Support for Markdown links: [text](url)
    // Use a placeholder strategy to prevent bare URL linkification from double-wrapping MD links.
    const placeholders = [];
    html = html.replace(MD_LINK_REGEX, (match, label, url) => {
      const id = `__MD_LINK_${placeholders.length}__`;
      placeholders.push(`<a href="${url}" class="card-link" target="_blank" rel="noopener noreferrer">${label}</a>`);
      return id;
    });

    html = html.replace(URL_REGEX, (url) => {
      // Clean up trailing punctuation that might be part of the sentence but not the URL
      let cleanUrl = url;
      const match = url.match(TRAILING_PUNCTUATION);
      let suffix = '';
      if (match) {
        cleanUrl = url.substring(0, url.length - match[0].length);
        suffix = match[0];
      }
      return `<a href="${cleanUrl}" class="card-link" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>${suffix}`;
    });

    // Performance: Use a single replace call with a callback to restore placeholders.
    // This reduces the restoration cost from O(M * N) to O(N) where M is the number
    // of links and N is the string length, ensuring linear-time substitution.
    // We use a nullish coalescing operator to ensure that if a sentinel is matched
    // without a corresponding placeholder, the original match is preserved.
    html = html.replace(MD_RESTORE_REGEX, (match, i) => placeholders[i] ?? match);

    return html;
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
