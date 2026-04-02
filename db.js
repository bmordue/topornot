const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'suggestions.json');

let _data = null;

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
  return _data;
}

function _save() {
  fs.writeFileSync(DB_PATH, JSON.stringify(_data, null, 2), 'utf8');
}

function closeDb() {
  _data = null;
}

function getPendingSuggestions() {
  return _load().suggestions.filter(s => s.status === 'pending')
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function getAllSuggestions() {
  return [..._load().suggestions].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function getSuggestionById(id) {
  return _load().suggestions.find(s => s.id === id) || null;
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
  _save();
  return suggestion;
}

function updateStatus(id, status) {
  const data = _load();
  const suggestion = data.suggestions.find(s => s.id === id);
  if (!suggestion) return null;
  suggestion.status = status;
  suggestion.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
  _save();
  return suggestion;
}

module.exports = { closeDb, getPendingSuggestions, getAllSuggestions, getSuggestionById, createSuggestion, updateStatus };
