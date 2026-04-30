/**
 * Authentication middleware for proxy-based identity.
 *
 * In production (AUTH_MODE=proxy) the service expects an upstream reverse proxy
 * (nginx + Authelia / oauth2-proxy) to inject identity headers.  Requests that
 * arrive without at least a `Remote-User` header are rejected with 401.
 *
 * In development (AUTH_MODE=dev, the default) stub identity headers are added
 * automatically so the service can run without the full auth stack.
 */

const AUTH_MODE = (process.env.AUTH_MODE || 'dev').toLowerCase();

const IDENTITY_HEADERS = {
  user:   'remote-user',
  groups: 'remote-groups',
  email:  'remote-email',
  name:   'remote-name',
};

const DEV_DEFAULTS = {
  'remote-user':   'dev-user',
  'remote-groups': 'dev',
  'remote-email':  'dev@localhost',
  'remote-name':   'Developer',
};

/**
 * Express middleware – attaches req.identity and logs the principal.
 */
function authMiddleware(req, res, next) {
  // In dev mode, fill in any missing identity headers with defaults
  if (AUTH_MODE === 'dev') {
    for (const [header, value] of Object.entries(DEV_DEFAULTS)) {
      if (!req.headers[header]) {
        req.headers[header] = value;
      }
    }
  }

  const user = req.headers[IDENTITY_HEADERS.user];

  // In proxy mode, reject requests without the required identity header
  if (AUTH_MODE === 'proxy' && !user) {
    return res.status(401).json({ error: 'Missing upstream identity header (Remote-User)' });
  }

  // Attach parsed identity to the request for downstream handlers
  req.identity = {
    user:   user || null,
    groups: req.headers[IDENTITY_HEADERS.groups] || null,
    email:  req.headers[IDENTITY_HEADERS.email] || null,
    name:   req.headers[IDENTITY_HEADERS.name] || null,
  };

  // Audit log – principal only, never tokens
  if (user) {
    // Security: Sanitize user for logging to prevent log injection
    const safeUser = String(user).replace(/[\r\n]/g, '_');
    console.log(`[auth] ${req.method} ${req.path} – user=${safeUser}`);
  }

  next();
}

module.exports = { authMiddleware, AUTH_MODE, IDENTITY_HEADERS, DEV_DEFAULTS };
