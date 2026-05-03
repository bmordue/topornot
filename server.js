const express = require('express');
const path = require('path');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const db = require('./db');
const { authMiddleware } = require('./auth');

const app = express();

// Trust the first proxy in front of us
app.set('trust proxy', 1);

// Security headers
app.use(helmet());

// Proxy-based identity – must come before routes
app.use(authMiddleware);

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Security: Use authenticated user for rate limiting key if available.
// When fallback to IP, it defaults to Express's req.ip.
const rateLimitKey = (req) => req.identity?.user || req.ip;

// General rate limiter for all API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 500, // Limit each principal to 500 requests per `window`
  keyGenerator: rateLimitKey,
  validate: { keyGeneratorIpFallback: false }, // User identifier might be anything
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});

// Stricter rate limiter for new suggestions (POST)
const suggestionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // Limit each principal to 100 requests per `window`
  keyGenerator: rateLimitKey,
  validate: { keyGeneratorIpFallback: false },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many suggestions from this user/IP, please try again after 15 minutes' }
});

// Apply general limiter to all /api routes
app.use('/api', apiLimiter);

// GET pending suggestions (used by the UI)
app.get('/api/suggestions', (req, res) => {
  // Security: Strictly validate status to prevent header injection in ETag
  const status = req.query.status === 'all' ? 'all' : 'pending';

  // Performance: Fast ETag validation using DB version and query status
  // This avoids full JSON serialization and hashing if data hasn't changed.
  const etag = `W/"v${db.getVersion()}-${status}"`;
  if (req.header('If-None-Match') === etag) {
    return res.status(304).send();
  }

  const json = status === 'all' ? db.getAllSuggestionsJson() : db.getPendingSuggestionsJson();
  res.set('ETag', etag);
  res.set('Content-Type', 'application/json');
  res.send(json);
});

// POST a new suggestion (used by agents)
app.post('/api/suggestions', suggestionLimiter, (req, res) => {
  const { title, description, context, agent } = req.body;

  if (!title || !description) {
    return res.status(400).json({ error: 'title and description are required' });
  }

  // Basic input validation
  if (typeof title !== 'string' || title.length > 100) {
    return res.status(400).json({ error: 'title must be a string up to 100 characters' });
  }
  if (typeof description !== 'string' || description.length > 1000) {
    return res.status(400).json({ error: 'description must be a string up to 1000 characters' });
  }
  if (context && (typeof context !== 'string' || context.length > 5000)) {
    return res.status(400).json({ error: 'context must be a string up to 5000 characters' });
  }
  if (agent && (typeof agent !== 'string' || agent.length > 100)) {
    return res.status(400).json({ error: 'agent must be a string up to 100 characters' });
  }

  const suggestion = db.createSuggestion({ title, description, context, agent, user: req.identity.user });
  res.status(201).json(suggestion);
});

// PATCH to update status: approve, reject, defer
app.patch('/api/suggestions/:id/:action', (req, res) => {
  const { id, action } = req.params;

  // Input validation: ensure ID is numeric
  if (isNaN(id) || Number(id) <= 0) {
    return res.status(400).json({ error: 'Invalid ID. Must be a positive number.' });
  }

  const validActions = ['approve', 'reject', 'defer'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` });
  }
  const statusMap = { approve: 'approved', reject: 'rejected', defer: 'pending' };
  const suggestion = db.updateStatus(Number(id), statusMap[action], req.identity.user);
  if (!suggestion) {
    return res.status(404).json({ error: 'Suggestion not found' });
  }
  res.json(suggestion);
});

// Catch-all 404 for API routes to prevent leaking Express default HTML error pages
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Global 404 handler for non-API routes to prevent leaking Express default HTML error pages
app.use((req, res) => {
  res.status(404).type('text/plain').send('404 Not Found');
});

// Global error handler to prevent stack trace leaks
app.use((err, req, res, next) => {
  // If it's a JSON parsing error from express.json()
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  // Handle entity too large error
  if (err.status === 413) {
    return res.status(413).json({ error: 'Payload too large' });
  }

  // Generic error handler
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || '127.0.0.1';
  app.listen(PORT, HOST, () => {
    console.log(`topornot server running on http://${HOST}:${PORT}`);
  });
}
