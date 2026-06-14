const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'suggestions.json');

let _data = null;
let _index = new Map();
let _pending = new Map();
let _version = 0;

// Fragment caches for fast O(1) serialization
// Performance: Use a Symbol to store fragment index directly on objects for faster O(1) lookup than Map.
const FRAGMENT_INDEX = Symbol('fragmentIndex');
let _fragments = [];

// Persistence throttling
let _pendingSave = null;
let _needsSave = false;
const SAVE_INTERVAL = 1000; // 1 second batching

// Timestamp caching for performance
let _lastNow = 0;
let _lastNowStr = '';

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
    } catch (err) {
      // Security: Throw on corruption to prevent silent data loss and DoS.
      // Defaulting to an empty state would cause the corrupted file to be overwritten on next save.
      throw new Error(`[db] Failed to parse database file ${DB_PATH}: ${err.message}`);
    }
  } else {
    _data = { nextId: 1, suggestions: [] };
  }
  _index.clear();
  _pending.clear();
  _cachePending = null;
  _cacheAll = null;
  _cachePendingJson = null;
  _cacheAllJson = null;
  _cachePendingJsonString = null;
  _cacheAllJsonString = null;

  const suggestions = _data.suggestions;
  const len = suggestions.length;
  // Performance: Initialize fragment cache as null for lazy stringification.
  // Using a pre-allocated array for better performance in V8.
  _fragments = new Array(len).fill(null);

  for (let i = 0; i < len; i++) {
    const s = suggestions[i];
    const id = s.id;
    _index.set(id, s);
    s[FRAGMENT_INDEX] = i;
    if (s.status === 'pending') {
      _pending.set(id, s);
    }
  }
  return _data;
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
  // Inlined _getFragment logic to avoid function call overhead in loop.
  for (let i = 0; i < _fragments.length; i++) {
    if (_fragments[i] === null) {
      _fragments[i] = JSON.stringify(_data.suggestions[i]);
    }
  }
  const json = `{"nextId":${_data.nextId},"suggestions":[${_fragments.join(',')}]}`;
  const tmpPath = `${DB_PATH}.tmp`;

  // Security: Set file permissions to 0o600 (owner read/write only) to protect sensitive data.
  // We use chmodSync because writeFileSync mode only applies to new files.
  // Performance: Atomic write via temp file + rename to prevent data corruption on crash.
  fs.writeFileSync(tmpPath, json, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(tmpPath, 0o600);
  } catch (err) {
    // Non-critical if chmod fails (e.g. on Windows or restricted filesystems)
    console.warn(`[db] Failed to set file permissions on ${tmpPath}: ${err.message}`);
  }
  fs.renameSync(tmpPath, DB_PATH);

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
      // Inlined _getFragment logic to avoid function call overhead in loop.
      const pendingFragments = new Map();
      for (const s of _pending.values()) {
        const fIdx = s[FRAGMENT_INDEX];
        if (fIdx !== undefined) {
          if (_fragments[fIdx] === null) {
            _fragments[fIdx] = JSON.stringify(s);
          }
          pendingFragments.set(s.id, _fragments[fIdx]);
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
      // Inlined _getFragment logic to avoid function call overhead in loop.
      const len = _fragments.length;
      const reversed = new Array(len);
      for (let i = 0; i < len; i++) {
        const idx = len - 1 - i;
        if (_fragments[idx] === null) {
          _fragments[idx] = JSON.stringify(_data.suggestions[idx]);
        }
        reversed[i] = _fragments[idx];
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

/**
 * Returns the current timestamp in "YYYY-MM-DD HH:MM:SS" format.
 * Performance: Uses second-level caching and manual UTC string construction
 * to avoid the overhead of toISOString() and regex string manipulation.
 */
function _getNow() {
  const now = Math.floor(Date.now() / 1000);
  if (now === _lastNow) return _lastNowStr;

  _lastNow = now;
  const d = new Date();
  const YYYY = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, '0');
  const DD = String(d.getUTCDate()).padStart(2, '0');
  const HH = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  _lastNowStr = `${YYYY}-${MM}-${DD} ${HH}:${mm}:${ss}`;
  return _lastNowStr;
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
  suggestion[FRAGMENT_INDEX] = _fragments.length;
  _fragments.push(newFragment);

  // Performance: Lazy invalidation for LIFO caches.
  // unshift() is O(N) and becomes a bottleneck as the dataset grows.
  // We move this cost to the next read to keep creation O(1).
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

  _save({ invalidatePending: false, invalidateAll: true });
  return suggestion;
}

function updateStatus(id, status, user) {
  _load();

  // Security: Defense-in-depth whitelist check for valid statuses.
  // This prevents persistence of unexpected status values if the API layer is bypassed.
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    throw new Error(`[db] Invalid status: ${status}`);
  }

  const suggestion = _index.get(id);
  if (!suggestion) return null;

  // Performance: Early return if status is unchanged to avoid redundant disk I/O
  if (suggestion.status === status) return suggestion;

  const oldStatus = suggestion.status;
  const fIdx = suggestion[FRAGMENT_INDEX];

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

  // Performance: Optimized Map and incremental JSON fragment cache updates.
  // Leverages Map insertion order to handle 'defer' by re-inserting at the end.
  if (status === 'pending') {
    if (oldStatus === 'pending') {
      // pending -> pending: Rotate to back for defer
      _pending.delete(id);
      _pending.set(id, suggestion);
      if (_cachePendingJson) {
        _cachePendingJson.delete(id);
        _cachePendingJson.set(id, newFragment);
        _cachePendingJsonString = null;
      }
    } else {
      // non-pending -> pending: Append
      _pending.set(id, suggestion);
      if (_cachePendingJson) {
        _cachePendingJson.set(id, newFragment);
        _cachePendingJsonString = null;
      }
    }
  } else if (oldStatus === 'pending') {
    // pending -> non-pending: Remove
    _pending.delete(id);
    if (_cachePendingJson) {
      _cachePendingJson.delete(id);
      _cachePendingJsonString = null;
    }
  }

  _save({ invalidatePending: false, invalidateAll: false });
  return suggestion;
}

module.exports = { flush, closeDb, getVersion, getPendingSuggestions, getAllSuggestions, getPendingSuggestionsJson, getAllSuggestionsJson, getSuggestionById, createSuggestion, updateStatus };
