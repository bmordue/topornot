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

// Security: Helper to sanitize identity headers to prevent log/header injection.
// Strips all C0 control characters and DEL to prevent terminal manipulation.
// Truncates to maxLen to prevent resource exhaustion/log bloat.
// Robustly handles array inputs from Express headers.
const sanitize = (val, maxLen = 255) => {
  if (!val) return null;
  const str = Array.isArray(val) ? String(val[0]) : String(val);
  return str.replace(/[\x00-\x1F\x7F]/g, '_').slice(0, maxLen);
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

  // Default to requiring authentication unless explicitly in dev mode.
  // This ensures a fail-closed posture if AUTH_MODE is misconfigured.
  if (AUTH_MODE !== 'dev' && !user) {
    // Security: Log unauthorized access attempts for auditability.
    // Sanitize req.ip to prevent log injection if proxy headers are spoofed.
    console.warn(`[auth] Unauthorized access attempt: Missing Remote-User from ${sanitize(req.ip)}`);
    return res.status(401).json({ error: 'Missing upstream identity header (Remote-User)' });
  }

  // Attach parsed identity to the request for downstream handlers.
  // Groups are typically longer (comma-separated), so we allow 1024 chars.
  req.identity = {
    user:   sanitize(user),
    groups: sanitize(req.headers[IDENTITY_HEADERS.groups], 1024),
    email:  sanitize(req.headers[IDENTITY_HEADERS.email]),
    name:   sanitize(req.headers[IDENTITY_HEADERS.name]),
  };

  // Audit log – principal only, never tokens.
  // Security: Sanitize method and path to prevent log injection.
  if (req.identity.user) {
    console.log(`[auth] ${sanitize(req.method)} ${sanitize(req.path)} – user=${req.identity.user}`);
  }

  next();
}

module.exports = { authMiddleware, AUTH_MODE, IDENTITY_HEADERS, DEV_DEFAULTS, sanitize };
