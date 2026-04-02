const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET pending suggestions (used by the UI)
app.get('/api/suggestions', (req, res) => {
  const status = req.query.status;
  const suggestions = status === 'all' ? db.getAllSuggestions() : db.getPendingSuggestions();
  res.json(suggestions);
});

// POST a new suggestion (used by agents)
app.post('/api/suggestions', (req, res) => {
  const { title, description, context, agent } = req.body;
  if (!title || !description) {
    return res.status(400).json({ error: 'title and description are required' });
  }
  const suggestion = db.createSuggestion({ title, description, context, agent });
  res.status(201).json(suggestion);
});

// PATCH to update status: approve, reject, defer
app.patch('/api/suggestions/:id/:action', (req, res) => {
  const { id, action } = req.params;
  const validActions = ['approve', 'reject', 'defer'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` });
  }
  const statusMap = { approve: 'approved', reject: 'rejected', defer: 'pending' };
  const suggestion = db.updateStatus(Number(id), statusMap[action]);
  if (!suggestion) {
    return res.status(404).json({ error: 'Suggestion not found' });
  }
  res.json(suggestion);
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`topornot server running on http://localhost:${PORT}`);
  });
}
