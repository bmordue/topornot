const fs = require('fs');
const path = require('path');

const DEFAULT_DB_PATH = path.join(__dirname, 'suggestions.json');

let _data = null;
let _index = new Map();

function _load() {
  if (_data) return _data;
  const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
  if (fs.existsSync(dbPath)) {
    try {
      _data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch {
      _data = { nextId: 1, suggestions: [] };
    }
  } else {
    _data = { nextId: 1, suggestions: [] };
  }

  // Build index for O(1) lookups
  _index.clear();
  _data.suggestions.forEach(s => _index.set(s.id, s));

  return _data;
}

function _save() {
  const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
  // Performance: Remove indentation to reduce file size and I/O
  fs.writeFileSync(dbPath, JSON.stringify(_data), 'utf8');
}

function closeDb() {
  _data = null;
  _index.clear();
}

function getPendingSuggestions() {
  // Optimization: Data is stored chronologically by insertion order.
  // Skipping redundant sort() since created_at follows insertion order.
  return _load().suggestions.filter(s => s.status === 'pending');
}

function getAllSuggestions() {
  // Optimization: Use reverse() to get latest first instead of full string-based sort().
  // suggestions are already in chronological order.
  return [..._load().suggestions].reverse();
}

function getSuggestionById(id) {
  _load();
  // Performance: O(1) lookup via Map
  return _index.get(id) || null;
}

function createSuggestion({ title, description, context, agent }) {
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
  _save();
  return suggestion;
}

function updateStatus(id, status) {
  _load();
  // Performance: O(1) lookup via Map
  const suggestion = _index.get(id);
  if (!suggestion) return null;
  suggestion.status = status;
  suggestion.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
  _save();
  return suggestion;
}

module.exports = { closeDb, getPendingSuggestions, getAllSuggestions, getSuggestionById, createSuggestion, updateStatus };
