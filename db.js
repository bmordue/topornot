const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'suggestions.json');

let _data = null;
let _index = new Map();

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
  for (const s of _data.suggestions) {
    _index.set(s.id, s);
  }
  return _data;
}

function _save() {
  fs.writeFileSync(DB_PATH, JSON.stringify(_data), 'utf8');
}

function closeDb() {
  _data = null;
}

function getPendingSuggestions() {
  // Suggestions are already in chronological order by creation
  return _load().suggestions.filter(s => s.status === 'pending');
}

function getAllSuggestions() {
  // Return in reverse chronological order (newest first)
  return [..._load().suggestions].reverse();
}

function getSuggestionById(id) {
  _load();
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
  const suggestion = _index.get(id);
  if (!suggestion) return null;
  suggestion.status = status;
  suggestion.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
  _save();
  return suggestion;
}

module.exports = { closeDb, getPendingSuggestions, getAllSuggestions, getSuggestionById, createSuggestion, updateStatus };
