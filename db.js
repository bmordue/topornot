const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'suggestions.json');

let _data = null;
let _index = new Map();
let _pending = new Map();
let _pendingIndexMap = new Map(); // id -> index in _cachePendingJson
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
  _pendingIndexMap.clear();
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
  _pendingIndexMap.clear();
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
      const pendingFragments = [];
      _pendingIndexMap.clear();
      for (const id of _pending.keys()) {
        const fIdx = _fragmentMap.get(id);
        if (fIdx !== undefined) {
          _pendingIndexMap.set(id, pendingFragments.length);
          pendingFragments.push(_getFragment(fIdx));
        }
      }
      _cachePendingJson = pendingFragments;
    }
    _cachePendingJsonString = `[${_cachePendingJson.join(',')}]`;
  }
  return _cachePendingJsonString;
}

function getAllSuggestionsJson() {
  _load();
  if (!_cacheAllJsonString) {
    if (!_cacheAllJson) {
      // Performance: Optimized fragment joining for API response.
      // Joins pre-stringified fragments in reverse order to match getAllSuggestions().
      const reversed = [];
      for (let i = _fragments.length - 1; i >= 0; i--) {
        reversed.push(_getFragment(i));
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

  if (_cacheAll) {
    _cacheAll.unshift(suggestion); // Suggestions are reversed in _cacheAll
  }
  if (_cachePending) {
    _cachePending.push(suggestion);
  }

  // Performance: Incremental JSON fragment cache updates
  if (_cacheAllJson) {
    _cacheAllJson.unshift(newFragment); // Prepend for LIFO order
    _cacheAllJsonString = null;
  }
  if (_cachePendingJson) {
    _pendingIndexMap.set(suggestion.id, _cachePendingJson.length);
    _cachePendingJson.push(newFragment);
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

  // Performance: Incremental fragment update
  const newFragment = JSON.stringify(suggestion);
  if (fIdx !== undefined) {
    _fragments[fIdx] = newFragment;
  }

  // Performance: Incremental JSON cache updates
  // Update _cacheAllJson in O(1) by calculating the reversed index
  if (_cacheAllJson && fIdx !== undefined) {
    const allIdx = _fragments.length - 1 - fIdx;
    if (allIdx >= 0 && allIdx < _cacheAllJson.length) {
      _cacheAllJson[allIdx] = newFragment;
      _cacheAllJsonString = null;
    }
  }

  // Update pending Map
  if (status === 'pending') {
    _pending.set(id, suggestion);
  } else {
    _pending.delete(id);
  }

  // Performance: Incremental array and JSON fragment cache updates
  if (status === 'pending' && oldStatus === 'pending') {
    // pending -> pending: Update in-place
    if (_cachePending) {
      const idx = _cachePending.indexOf(suggestion);
      if (idx !== -1 && _cachePendingJson) {
        _cachePendingJson[idx] = newFragment;
        _cachePendingJsonString = null;
      }
    } else if (_cachePendingJson) {
      const idx = _pendingIndexMap.has(id) ? _pendingIndexMap.get(id) : _cachePendingJson.indexOf(oldFragment);
      if (idx !== -1) {
        _cachePendingJson[idx] = newFragment;
        _cachePendingJsonString = null;
        _pendingIndexMap.set(id, idx);
      }
    }
  } else if (status === 'pending') {
    // non-pending -> pending: Append
    if (_cachePending) _cachePending.push(suggestion);
    if (_cachePendingJson) {
      _pendingIndexMap.set(id, _cachePendingJson.length);
      _cachePendingJson.push(newFragment);
      _cachePendingJsonString = null;
    }
  } else if (oldStatus === 'pending') {
    // pending -> non-pending: Remove
    if (_cachePending) {
      const idx = _cachePending.indexOf(suggestion);
      if (idx !== -1) {
        _cachePending.splice(idx, 1);
        if (_cachePendingJson) {
          const pIdx = _pendingIndexMap.has(id) ? _pendingIndexMap.get(id) : idx;
          _cachePendingJson.splice(pIdx, 1);
          _cachePendingJsonString = null;
          _pendingIndexMap.delete(id);
          // Re-index remaining items in _pendingIndexMap if we didn't just clear it via _cachePending
          if (pIdx < _cachePendingJson.length) {
            for (let i = pIdx; i < _cachePendingJson.length; i++) {
              const item = _cachePending[i];
              if (item) _pendingIndexMap.set(item.id, i);
            }
          }
        }
      }
    } else if (_cachePendingJson) {
      const idx = _pendingIndexMap.has(id) ? _pendingIndexMap.get(id) : _cachePendingJson.indexOf(oldFragment);
      if (idx !== -1) {
        _cachePendingJson.splice(idx, 1);
        _cachePendingJsonString = null;
        _pendingIndexMap.delete(id);
        // O(N) re-indexing is required here because we don't have _cachePending to quickly find IDs.
        // However, this path is only hit if _cachePending is null, and we've still avoided the indexOf(oldFragment) O(N) search.
        _pendingIndexMap.clear(); // Simpler to clear and let next read rebuild it O(N) if needed
      }
    }
  }

  _save({ invalidatePending: false, invalidateAll: false });
  return suggestion;
}

module.exports = { flush, closeDb, getVersion, getPendingSuggestions, getAllSuggestions, getPendingSuggestionsJson, getAllSuggestionsJson, getSuggestionById, createSuggestion, updateStatus };
