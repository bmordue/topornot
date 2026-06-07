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
// Strips all C0/C1 control characters, DEL, and dangerous Unicode BiDi/zero-width/separator characters
// to prevent terminal manipulation and visual spoofing.
// Truncates to maxLen to prevent resource exhaustion/log bloat.
// Robustly handles array inputs from Express headers.

// C0/C1 control characters, DEL, soft hyphen, and Unicode BiDi/zero-width/separator formatting characters.
// Includes Mongolian Vowel Separator, Variation Selectors, and the full General Punctuation invisible block.
// Hoisted to module scope for performance.
const CONTROL_CHARS = /[\x00-\x1F\x7F-\x9F\u00AD\u180E\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\uFEFF]/;
const CONTROL_CHARS_G = new RegExp(CONTROL_CHARS.source, 'g');

// Performance: Fast-path for printable ASCII characters.
const SIMPLE_ASCII = /^[\x20-\x7E]*$/;

const sanitize = (val, maxLen = 255) => {
  if (val === undefined || val === null) return null;
  const raw = Array.isArray(val) ? val[0] : val;
  if (raw === undefined || raw === null) return null;

  let str = (typeof raw === 'string') ? raw : String(raw);

  // Performance: Fast-path for simple ASCII strings within length limit.
  // test() is faster than normalize() + test() + replace() and avoids new string allocation.
  // This covers common cases like IPs, HTTP methods, and standard usernames.
  if (str.length <= maxLen && SIMPLE_ASCII.test(str)) {
    return str;
  }

  // Security: Apply Unicode Normalization (NFKC) to ensure consistent representation
  // and prevent bypasses using visually similar characters.
  str = str.normalize('NFKC');

  // Performance: Truncate BEFORE testing or replacing to avoid scanning large inputs.
  // This ensures we only perform O(maxLen) work regardless of input size.
  const truncated = str.length <= maxLen ? str : str.slice(0, maxLen);

  // Performance: Fast-path for clean strings (test() is faster than replace() and avoids new string allocation).
  return CONTROL_CHARS.test(truncated) ? truncated.replace(CONTROL_CHARS_G, '_') : truncated;
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
    // Sanitize method, path, and IP to prevent log injection.
    // Use originalUrl to ensure the full path is logged.
    console.warn(`[auth] Unauthorized access attempt: ${sanitize(req.method)} ${sanitize(req.originalUrl)} user=anonymous ip=${sanitize(req.ip)}`);
    // Security: Prevent caching of unauthorized responses to protect privacy.
    res.setHeader('Cache-Control', 'no-store, max-age=0');
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
  // Security: Sanitize method, path, and IP to prevent log injection.
  // Use originalUrl to ensure the full path is logged.
  if (req.identity.user) {
    console.log(`[auth] ${sanitize(req.method)} ${sanitize(req.originalUrl)} user=${req.identity.user} ip=${sanitize(req.ip)}`);
  }

  next();
}

module.exports = { authMiddleware, AUTH_MODE, IDENTITY_HEADERS, DEV_DEFAULTS, sanitize };
