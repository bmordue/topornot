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
    _fragments.push(JSON.stringify(s));
    if (s.status === 'pending') {
      _pending.set(s.id, s);
    }
  });
  return _data;
}

/**
 * Internal save helper.
 * Performance: Supports granular cache invalidation to avoid redundant O(N) operations.
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

  // Performance: Optimized serialization using fragment joining.
  // This avoids full-array JSON.stringify(suggestions) which is O(N) and slow.
  const json = `{"nextId":${_data.nextId},"suggestions":[${_fragments.join(',')}]}`;
  fs.writeFileSync(DB_PATH, json, 'utf8');
}

function closeDb() {
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
        pendingFragments.push(_fragments[fIdx]);
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
      reversed.push(_fragments[i]);
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
  _fragments.push(JSON.stringify(suggestion));

  if (_cacheAll) {
    _cacheAll.unshift(suggestion); // Suggestions are reversed in _cacheAll
  }
  if (_cachePending) {
    _cachePending.push(suggestion);
  }

  // Invalidate all caches as membership changed, but we updated arrays incrementally
  // Invalidate JSON caches because the content has changed
  _save({ invalidatePending: false, invalidateAll: false });
  _cachePendingJson = null;
  _cacheAllJson = null;
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
  if (fIdx !== undefined) {
    _fragments[fIdx] = JSON.stringify(suggestion);
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

  // Performance: Skip invalidating _cacheAll as membership and order are unchanged.
  // The mutated suggestion object is already reflected in the cached array.
  // Invalidate pending only if it wasn't updated incrementally.
  // Invalidate JSON caches because the content has changed
  _save({ invalidatePending: false, invalidateAll: false });
  _cachePendingJson = null;
  _cacheAllJson = null;
  return suggestion;
}

module.exports = { closeDb, getVersion, getPendingSuggestions, getAllSuggestions, getPendingSuggestionsJson, getAllSuggestionsJson, getSuggestionById, createSuggestion, updateStatus };
