const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'suggestions.json');

let _data = null;
let _index = new Map();
let _pending = new Map();
let _version = 0;

// Fragment caches for fast O(1) serialization
let _fragments = [];
let _fragmentMap = new Map(); // id -> index in _fragments

// Persistence throttling
let _pendingSave = null;
let _needsSave = false;
const SAVE_INTERVAL = 1000; // 1 second batching

// Result caches to avoid repeated O(N) conversions
let _cachePending = null;
let _cacheAll = null;
let _cachePendingJson = null;
let _cacheAllJson = null;

function _load() {
  if (_data) return _data;
  if (fs.existsSync(DB_PATH)) {
    try {
      _data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch {
      _data = { nextId: 1, suggestions: [] };
    }
  } else {
    _data = { nextId: 1, suggestions: [] };
  }
  _index.clear();
  _pending.clear();
  _fragmentMap.clear();
  _fragments = [];
  _cachePending = null;
  _cacheAll = null;
  _cachePendingJson = null;
  _cacheAllJson = null;
  _data.suggestions.forEach((s, i) => {
    _index.set(s.id, s);
    _fragmentMap.set(s.id, i);
    // Performance: Initialize fragment cache as null for lazy stringification.
    // This avoids O(N) JSON.stringify calls during initial load.
    _fragments.push(null);
    if (s.status === 'pending') {
      _pending.set(s.id, s);
    }
  });
  return _data;
}

/**
 * Lazy fragment stringification helper.
 * Returns a pre-stringified JSON fragment for a suggestion, stringifying it on demand if needed.
 */
function _getFragment(i) {
  if (_fragments[i] === null) {
    _fragments[i] = JSON.stringify(_data.suggestions[i]);
  }
  return _fragments[i];
}

/**
 * Forces a write of any pending data to disk.
 * Performance: Batches multiple writes into a single synchronous I/O operation.
 */
function flush() {
  if (!_needsSave) return;

  // Ensure data is loaded before serializing
  _load();

  // Performance: Optimized serialization using fragment joining.
  const fragments = [];
  for (let i = 0; i < _fragments.length; i++) {
    fragments.push(_getFragment(i));
  }
  const json = `{"nextId":${_data.nextId},"suggestions":[${fragments.join(',')}]}`;
  fs.writeFileSync(DB_PATH, json, 'utf8');

  _needsSave = false;
  if (_pendingSave) {
    clearTimeout(_pendingSave);
    _pendingSave = null;
  }
}

/**
 * Internal save helper.
 * Performance: Supports granular cache invalidation and throttled disk persistence.
 */
function _save({ invalidatePending = true, invalidateAll = true } = {}) {
  _version++; // Increment version on every write
  if (invalidatePending) {
    _cachePending = null;
    _cachePendingJson = null;
  }
  if (invalidateAll) {
    _cacheAll = null;
    _cacheAllJson = null;
  }

  _needsSave = true;
  if (!_pendingSave) {
    _pendingSave = setTimeout(() => flush(), SAVE_INTERVAL);
    // Unref allows the process to exit even if the timer is active.
    // We handle final persistence via SIGTERM/SIGINT handlers in server.js.
    if (_pendingSave.unref) _pendingSave.unref();
  }
}

function closeDb() {
  flush(); // Ensure everything is saved before clearing
  _data = null;
  _cachePending = null;
  _cacheAll = null;
  _cachePendingJson = null;
  _cacheAllJson = null;
}

function getVersion() {
  _load();
  return _version;
}

function getPendingSuggestions() {
  _load();
  if (!_cachePending) {
    // Cache the array conversion
    _cachePending = Array.from(_pending.values());
  }
  return _cachePending;
}

function getAllSuggestions() {
  _load();
  if (!_cacheAll) {
    // Cache the reversed copy
    _cacheAll = [..._data.suggestions].reverse();
  }
  return _cacheAll;
}

function getPendingSuggestionsJson() {
  _load();
  if (!_cachePendingJson) {
    // Performance: Optimized fragment joining for API response.
    // Avoids O(N) object graph traversal of JSON.stringify.
    const pendingFragments = [];
    for (const id of _pending.keys()) {
      const fIdx = _fragmentMap.get(id);
      if (fIdx !== undefined) {
        pendingFragments.push(_getFragment(fIdx));
      }
    }
    _cachePendingJson = `[${pendingFragments.join(',')}]`;
  }
  return _cachePendingJson;
}

function getAllSuggestionsJson() {
  _load();
  if (!_cacheAllJson) {
    // Performance: Optimized fragment joining for API response.
    // Joins pre-stringified fragments in reverse order to match getAllSuggestions().
    const reversed = [];
    for (let i = _fragments.length - 1; i >= 0; i--) {
      reversed.push(_getFragment(i));
    }
    _cacheAllJson = `[${reversed.join(',')}]`;
  }
  return _cacheAllJson;
}

function getSuggestionById(id) {
  _load();
  return _index.get(id) || null;
}

function createSuggestion({ title, description, context, agent, user }) {
  const data = _load();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const suggestion = {
    id: data.nextId++,
    title,
    description,
    context: context || null,
    agent: agent || null,
    status: 'pending',
    created_at: now,
    updated_at: now,
    created_by: user || null,
    updated_by: user || null
  };
  data.suggestions.push(suggestion);
  _index.set(suggestion.id, suggestion);
  _pending.set(suggestion.id, suggestion); // Cache as pending

  // Performance: Incremental fragment and array cache updates
  _fragmentMap.set(suggestion.id, _fragments.length);
  const frag = JSON.stringify(suggestion);
  _fragments.push(frag);

  if (_cacheAll) {
    _cacheAll.unshift(suggestion); // Suggestions are reversed in _cacheAll
  }
  if (_cachePending) {
    _cachePending.push(suggestion);
  }

  // Performance: Incremental JSON cache updates
  if (_cacheAllJson !== null) {
    _cacheAllJson = _cacheAllJson === '[]' ? `[${frag}]` : `[${frag},${_cacheAllJson.slice(1)}`;
  }
  if (_cachePendingJson !== null) {
    _cachePendingJson = _cachePendingJson === '[]' ? `[${frag}]` : `${_cachePendingJson.slice(0, -1)},${frag}]`;
  }

  // Invalidate all caches as membership changed, but we updated arrays incrementally
  // We also updated JSON caches incrementally above.
  _save({ invalidatePending: false, invalidateAll: false });
  return suggestion;
}

function updateStatus(id, status, user) {
  _load();
  const suggestion = _index.get(id);
  if (!suggestion) return null;

  // Performance: Early return if status is unchanged to avoid redundant disk I/O
  if (suggestion.status === status) return suggestion;

  const oldStatus = suggestion.status;
  suggestion.status = status;
  suggestion.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
  suggestion.updated_by = user || null;

  // Performance: Incremental fragment update
  const fIdx = _fragmentMap.get(id);
  let frag = null;
  if (fIdx !== undefined) {
    frag = JSON.stringify(suggestion);
    _fragments[fIdx] = frag;
  }

  // Update pending Map
  if (status === 'pending') {
    _pending.set(id, suggestion);
  } else {
    _pending.delete(id);
  }

  // Performance: Incremental _cachePending update
  if (_cachePending) {
    if (status === 'pending') {
      _cachePending.push(suggestion);
    } else if (oldStatus === 'pending') {
      const idx = _cachePending.findIndex(s => s.id === id);
      if (idx !== -1) _cachePending.splice(idx, 1);
    }
  }

  // Performance: Incremental JSON cache updates
  if (_cachePendingJson !== null) {
    if (status === 'pending' && oldStatus !== 'pending') {
      _cachePendingJson = _cachePendingJson === '[]' ? `[${frag}]` : `${_cachePendingJson.slice(0, -1)},${frag}]`;
    } else if (status !== 'pending' && oldStatus === 'pending') {
      _cachePendingJson = null; // Removal is O(N), invalidate
    }
  }
  // _cacheAllJson is invalidated because an item was mutated.
  // Although membership is the same, the content of one fragment changed.
  // We could do O(N) string replace but it's risky and O(N).
  // Invalidate it so it's rebuilt from updated _fragments (which is O(N) join, but still better than full stringify).
  _cacheAllJson = null;

  // Performance: Skip invalidating _cacheAll as membership and order are unchanged.
  // The mutated suggestion object is already reflected in the cached array.
  _save({ invalidatePending: false, invalidateAll: false });
  return suggestion;
}

module.exports = { flush, closeDb, getVersion, getPendingSuggestions, getAllSuggestions, getPendingSuggestionsJson, getAllSuggestionsJson, getSuggestionById, createSuggestion, updateStatus };
