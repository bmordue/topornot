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

// JSON caches to avoid repeated O(N) stringification
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
async function _save({ invalidatePending = true, invalidateAll = true } = {}) {
  _version++; // Increment version on every write
  if (invalidatePending) _cachePending = null;
  if (invalidateAll) _cacheAll = null;

  // Performance: Always invalidate JSON caches on save as the underlying data has changed.
  // We still preserve _cachePending/_cacheAll arrays if requested to avoid O(N) array ops.
  _cachePendingJson = null;
  _cacheAllJson = null;

  // Performance: Use async writeFile to avoid blocking the event loop on I/O.
  await fs.promises.writeFile(DB_PATH, JSON.stringify(_data), 'utf8');
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

/**
 * Performance: Returns pre-stringified JSON of all suggestions to avoid O(N) serialization cost.
 */
function getAllSuggestionsJson() {
  _load();
  if (!_cacheAllJson) {
    _cacheAllJson = JSON.stringify(getAllSuggestions());
  }
  return _cacheAllJson;
}

/**
 * Performance: Returns pre-stringified JSON of pending suggestions to avoid O(N) serialization cost.
 */
function getPendingSuggestionsJson() {
  _load();
  if (!_cachePendingJson) {
    _cachePendingJson = JSON.stringify(getPendingSuggestions());
  }
  return _cachePendingJson;
}

function getSuggestionById(id) {
  _load();
  return _index.get(id) || null;
}

async function createSuggestion({ title, description, context, agent }) {
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
    updated_at: now
  };
  data.suggestions.push(suggestion);
  _index.set(suggestion.id, suggestion);
  _pending.set(suggestion.id, suggestion); // Cache as pending
  await _save(); // Invalidate all caches as membership changed
  return suggestion;
}

async function updateStatus(id, status) {
  _load();
  const suggestion = _index.get(id);
  if (!suggestion) return null;

  // Performance: Early return if status is unchanged to avoid redundant disk I/O
  if (suggestion.status === status) return suggestion;

  suggestion.status = status;
  suggestion.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Update pending cache
  if (status === 'pending') {
    _pending.set(id, suggestion);
  } else {
    _pending.delete(id);
  }

  // Performance: Skip invalidating _cacheAll as membership and order are unchanged.
  // The mutated suggestion object is already reflected in the cached array.
  await _save({ invalidateAll: false });
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
