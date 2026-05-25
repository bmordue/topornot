const express = require('express');
const path = require('path');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const db = require('./db');
const { authMiddleware, sanitize } = require('./auth');

const app = express();

// Security: Restrict unnecessary browser features via Permissions-Policy.
// Explicitly disable features that the application does not require.
const PERMISSIONS_POLICY = 'accelerometer=(), camera=(), fullscreen=(), geolocation=(), gyroscope=(), interest-cohort=(), browsing-topics=(), run-ad-auction=(), join-ad-interest-group=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), sync-xhr=(), usb=(), web-share=(), xr-spatial-tracking=()';

// Trust the first proxy in front of us
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      "default-src": ["'none'"],
      "script-src": ["'self'"],
      "style-src": ["'self'"],
      "img-src": ["'self'"],
      "connect-src": ["'self'"],
      "manifest-src": ["'self'"],
      "worker-src": ["'self'"],
      "object-src": ["'none'"],
      "frame-ancestors": ["'none'"],
      "base-uri": ["'none'"],
      "form-action": ["'none'"],
      "upgrade-insecure-requests": [],
    },
  },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'no-referrer' },
  permittedCrossDomainPolicies: { policy: 'none' },
}));

// Security: Apply restrictive Permissions-Policy and prevent indexing by search engines.
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

// Proxy-based identity – must come before routes
app.use(authMiddleware);

app.use(express.json({ limit: '10kb' }));
// Security: Prevent access to dotfiles in public directory.
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny' }));

// Security: Use authenticated user for rate limiting key if available.
// When fallback to IP, it defaults to Express's req.ip.
// The key is sanitized to prevent log injection if the key is used in logs.
const rateLimitKey = (req) => sanitize(req.identity?.user || req.ip);

// Custom rate limit handler to ensure security headers are set on 429 responses.
const rateLimitHandler = (req, res, next, options) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(options.statusCode).send(options.message);
};

// General rate limiter for all API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 500, // Limit each principal to 500 requests per `window`
  keyGenerator: rateLimitKey,
  validate: { keyGeneratorIpFallback: false }, // User identifier might be anything
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  handler: rateLimitHandler
});

// Stricter rate limiter for new suggestions (POST)
const suggestionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // Limit each principal to 100 requests per `window`
  keyGenerator: rateLimitKey,
  validate: { keyGeneratorIpFallback: false },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many suggestions from this user/IP, please try again after 15 minutes' },
  handler: rateLimitHandler
});

// Stricter rate limiter for acting on suggestions (PATCH)
const actionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // Limit each principal to 100 requests per `window`
  keyGenerator: rateLimitKey,
  validate: { keyGeneratorIpFallback: false },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many actions from this user/IP, please try again after 15 minutes' },
  handler: rateLimitHandler
});

// Apply general limiter to all /api routes
app.use('/api', apiLimiter);

// GET pending suggestions (used by the UI)
app.get('/api/suggestions', (req, res) => {
  // Security: Ensure sensitive suggestion data isn't cached by intermediaries
  res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');

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
  // Security: Prevent caching of validation errors or sensitive created data.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
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

  const suggestion = db.createSuggestion({
    title: sanitize(title, 100),
    description: sanitize(description, 1000),
    context: sanitize(context, 5000),
    agent: sanitize(agent, 100),
    user: req.identity.user
  });
  // Security: Audit log for new suggestion
  console.log(`[audit] SUGGESTION_CREATE: id=${suggestion.id} user=${req.identity.user} ip=${sanitize(req.ip)}`);
  res.status(201).json(suggestion);
});

// PATCH to update status: approve, reject, defer
app.patch('/api/suggestions/:id/:action', actionLimiter, (req, res) => {
  // Security: Prevent caching of validation errors or sensitive updated data.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const { id, action } = req.params;

  // Input validation: ensure ID is a safe numeric integer
  const numId = Number(id);
  if (!Number.isSafeInteger(numId) || numId <= 0) {
    return res.status(400).json({ error: 'Invalid ID. Must be a positive safe integer.' });
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
  // Security: Audit log for status change
  console.log(`[audit] SUGGESTION_UPDATE: id=${suggestion.id} action=${sanitize(action)} user=${req.identity.user} ip=${sanitize(req.ip)} status=${suggestion.status}`);
  res.json(suggestion);
});

// Catch-all 404 for API routes to prevent leaking Express default HTML error pages
app.use('/api', (req, res) => {
  // Security: Prevent caching of error responses to avoid leaking info.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(404).json({ error: 'API endpoint not found' });
});

// Global 404 handler for non-API routes to prevent leaking Express default HTML error pages
app.use((req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(404).type('text/plain').send('404 Not Found');
});

// Global error handler to prevent stack trace leaks
app.use((err, req, res, next) => {
  // Security: Prevent caching of error responses.
  res.setHeader('Cache-Control', 'no-store, max-age=0');

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
module.exports.PERMISSIONS_POLICY = PERMISSIONS_POLICY;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || '127.0.0.1';
  const server = app.listen(PORT, HOST, () => {
    console.log(`topornot server running on http://${HOST}:${PORT}`);
  });

  // Performance: Ensure all pending DB writes are flushed to disk before exit.
  const shutdown = () => {
    console.log('Shutting down...');
    db.flush();
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
    // Force exit if server.close hangs
    setTimeout(() => process.exit(0), 1000).unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
