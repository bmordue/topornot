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
let _cachePendingJson = null; // Map<id, fragment>
let _cacheAllJson = null;
let _cachePendingJsonString = null;
let _cacheAllJsonString = null;

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
  _cachePendingJsonString = null;
  _cacheAllJsonString = null;
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
  // We ensure all fragments are stringified first.
  for (let i = 0; i < _fragments.length; i++) {
    _getFragment(i);
  }
  const json = `{"nextId":${_data.nextId},"suggestions":[${_fragments.join(',')}]}`;
  // Security: Set file permissions to 0o600 (owner read/write only) to protect sensitive data.
  fs.writeFileSync(DB_PATH, json, { encoding: 'utf8', mode: 0o600 });

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
    _cachePendingJsonString = null;
  }
  if (invalidateAll) {
    _cacheAll = null;
    _cacheAllJson = null;
    _cacheAllJsonString = null;
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
  _cachePendingJsonString = null;
  _cacheAllJsonString = null;
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
  if (!_cachePendingJsonString) {
    if (!_cachePendingJson) {
      // Performance: Optimized fragment joining for API response.
      // Avoids O(N) object graph traversal of JSON.stringify.
      const pendingFragments = new Map();
      for (const id of _pending.keys()) {
        const fIdx = _fragmentMap.get(id);
        if (fIdx !== undefined) {
          pendingFragments.set(id, _getFragment(fIdx));
        }
      }
      _cachePendingJson = pendingFragments;
    }
    _cachePendingJsonString = `[${Array.from(_cachePendingJson.values()).join(',')}]`;
  }
  return _cachePendingJsonString;
}

function getAllSuggestionsJson() {
  _load();
  if (!_cacheAllJsonString) {
    if (!_cacheAllJson) {
      // Performance: Optimized fragment joining for API response.
      // Joins pre-stringified fragments in reverse order to match getAllSuggestions().
      // Using a pre-allocated array for better performance in V8.
      const len = _fragments.length;
      const reversed = new Array(len);
      for (let i = 0; i < len; i++) {
        reversed[i] = _getFragment(len - 1 - i);
      }
      _cacheAllJson = reversed;
    }
    _cacheAllJsonString = `[${_cacheAllJson.join(',')}]`;
  }
  return _cacheAllJsonString;
}

function getSuggestionById(id) {
  _load();
  return _index.get(id) || null;
}

function _getNow() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function createSuggestion({ title, description, context, agent, user }) {
  const data = _load();
  const now = _getNow();
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
  const newFragment = JSON.stringify(suggestion);
  _fragmentMap.set(suggestion.id, _fragments.length);
  _fragments.push(newFragment);

  // Performance: Invalidate LIFO caches to avoid O(N) unshift cost.
  // Next read will rebuild these in O(N).
  _cacheAll = null;
  _cacheAllJson = null;
  _cacheAllJsonString = null;

  // Incremental update for pending cache (FIFO) is O(1) via push.
  if (_cachePending) {
    _cachePending.push(suggestion);
  }

  if (_cachePendingJson) {
    _cachePendingJson.set(suggestion.id, newFragment);
    _cachePendingJsonString = null;
  }

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
  const fIdx = _fragmentMap.get(id);
  const oldFragment = fIdx !== undefined ? _getFragment(fIdx) : null;

  suggestion.status = status;
  suggestion.updated_at = _getNow();
  suggestion.updated_by = user || null;

  // Performance: Incremental fragment and cache updates.
  const newFragment = JSON.stringify(suggestion);
  if (fIdx !== undefined) {
    _fragments[fIdx] = newFragment;

    // Uses reverse index mapping (length - 1 - fIdx) to update LIFO-ordered 'all' caches in-place.
    const reverseIdx = _data.suggestions.length - 1 - fIdx;
    if (_cacheAll) _cacheAll[reverseIdx] = suggestion;
    if (_cacheAllJson) _cacheAllJson[reverseIdx] = newFragment;
  }
  _cacheAllJsonString = null;

  // Pending array is more complex to update incrementally due to filtering,
  // so we invalidate it. The pending Map-based JSON cache is updated below.
  _cachePending = null;

  // Update pending Map
  if (status === 'pending') {
    _pending.set(id, suggestion);
  } else {
    _pending.delete(id);
  }

  // Performance: Incremental JSON fragment cache updates
  if (status === 'pending' && oldStatus === 'pending') {
    // pending -> pending: Rotate to back for defer
    _pending.delete(id);
    _pending.set(id, suggestion);

    if (_cachePendingJson) {
      _cachePendingJson.delete(id);
      _cachePendingJson.set(id, newFragment);
      _cachePendingJsonString = null;
    }
  } else if (status === 'pending') {
    // non-pending -> pending: Append
    if (_cachePendingJson) {
      _cachePendingJson.set(id, newFragment);
      _cachePendingJsonString = null;
    }
  } else if (oldStatus === 'pending') {
    // pending -> non-pending: Remove
    if (_cachePendingJson) {
      _cachePendingJson.delete(id);
      _cachePendingJsonString = null;
    }
  }

  _save({ invalidatePending: false, invalidateAll: false });
  return suggestion;
}

module.exports = { flush, closeDb, getVersion, getPendingSuggestions, getAllSuggestions, getPendingSuggestionsJson, getAllSuggestionsJson, getSuggestionById, createSuggestion, updateStatus };
