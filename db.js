const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'suggestions.json');

let _data = null;
let _index = new Map();
let _pending = new Map();
let _version = 0;

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
  _cachePending = null;
  _cacheAll = null;
  for (const s of _data.suggestions) {
    _index.set(s.id, s);
    if (s.status === 'pending') {
      _pending.set(s.id, s);
    }
  }
  return _data;
}

/**
 * Internal save helper.
 * Performance: Supports granular cache invalidation to avoid redundant O(N) operations.
 */
function _save({ invalidatePending = true, invalidateAll = true, invalidatePendingJson = true, invalidateAllJson = true } = {}) {
  _version++; // Increment version on every write
  if (invalidatePending) _cachePending = null;
  if (invalidateAll) _cacheAll = null;
  if (invalidatePendingJson) _cachePendingJson = null;
  if (invalidateAllJson) _cacheAllJson = null;
  fs.writeFileSync(DB_PATH, JSON.stringify(_data), 'utf8');
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
    _cachePendingJson = JSON.stringify(getPendingSuggestions());
  }
  return _cachePendingJson;
}

function getAllSuggestionsJson() {
  _load();
  if (!_cacheAllJson) {
    _cacheAllJson = JSON.stringify(getAllSuggestions());
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
  _pending.set(suggestion.id, suggestion);

  // Performance: Incremental update of array caches to avoid O(N) rebuilds
  if (_cacheAll) _cacheAll.unshift(suggestion);
  if (_cachePending) _cachePending.push(suggestion);

  // Invalidate JSON caches as membership changed
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

  // Update pending Map and incrementally update _cachePending array
  let invalidatePending = false;
  if (status === 'pending') {
    _pending.set(id, suggestion);
    if (_cachePending) _cachePending.push(suggestion);
  } else {
    _pending.delete(id);
    if (_cachePending) {
      const idx = _cachePending.findIndex(s => s.id === id);
      if (idx !== -1) _cachePending.splice(idx, 1);
    }
  }

  // Performance: Skip invalidating _cacheAll as membership and order are unchanged.
  // Invalidate only JSON caches.
  _save({
    invalidateAll: false,
    invalidatePending: false,
    invalidatePendingJson: true,
    invalidateAllJson: true
  });
  return suggestion;
}

module.exports = {
  closeDb,
  getVersion,
  getPendingSuggestions,
  getAllSuggestions,
  getPendingSuggestionsJson,
  getAllSuggestionsJson,
  getSuggestionById,
  createSuggestion,
  updateStatus
};
