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
// Includes Mongolian Vowel Separator, Mongolian Free Variation Selectors, Variation Selectors,
// Hangul fillers, Braille blank, Combining Grapheme Joiner, Khmer Vowel Inherent,
// and the full General Punctuation invisible block.
// Hoisted to module scope for performance.
const CONTROL_CHARS = /[\x00-\x1F\x7F-\x9F\u00AD\u034F\u{110BD}\u115F\u1160\u17B4\u17B5\u180B-\u180D\u180E\u2000-\u200F\u2028-\u202E\u202F\u205F\u2060-\u206F\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFC\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/u;
const CONTROL_CHARS_G = new RegExp(CONTROL_CHARS.source, 'gu');

// Performance: Fast-path for printable ASCII characters.
const SIMPLE_ASCII = /^[\x20-\x7E]*$/;

const sanitize = (val, maxLen = 255) => {
  if (val === undefined || val === null) return null;
  const raw = Array.isArray(val) ? val[0] : val;
  if (raw === undefined || raw === null) return null;

  // Performance: Immediate early-exit for simple ASCII strings already within limits.
  // This avoids redundant type conversion, rough truncation, and extra length checks.
  if (typeof raw === 'string' && raw.length <= maxLen && SIMPLE_ASCII.test(raw)) {
    return raw;
  }

  let str = (typeof raw === 'string') ? raw : String(raw);

  // Performance: Rough truncation to prevent DoS on extremely large payloads
  // while ensuring we don't break multi-code-point sequences at the boundary
  // before normalization.
  const roughLimit = maxLen + 64;
  const rough = str.length <= roughLimit ? str : str.slice(0, roughLimit);

  // Performance: Fast-path for simple ASCII strings.
  // test() is faster than normalize() + test() + replace() and avoids new string allocation.
  // This covers common cases like IPs, HTTP methods, and standard usernames.
  if (SIMPLE_ASCII.test(rough)) {
    return rough.length <= maxLen ? rough : rough.slice(0, maxLen);
  }

  // Security: Apply Unicode Normalization (NFKC) to ensure consistent representation
  // and prevent bypasses using visually similar characters.
  const normalized = rough.normalize('NFKC');

  // Performance: Truncate BEFORE testing or replacing to avoid scanning large inputs.
  // This ensures we only perform O(maxLen) work regardless of input size.
  const truncated = normalized.length <= maxLen ? normalized : normalized.slice(0, maxLen);

  // Performance: Fast-path for clean strings (test() is faster than replace() and avoids new string allocation).
  return CONTROL_CHARS.test(truncated) ? truncated.replace(CONTROL_CHARS_G, '_') : truncated;
};

/**
 * Identity extraction middleware – attaches req.identity without enforcing authentication.
 * Allows early access to identity for rate limiting and logging purposes.
 */
function identityMiddleware(req, res, next) {
  // In dev mode, fill in any missing identity headers with defaults
  if (AUTH_MODE === 'dev') {
    for (const [header, value] of Object.entries(DEV_DEFAULTS)) {
      if (!req.headers[header]) {
        req.headers[header] = value;
      }
    }
  }

  // user is eager as it's required for rate limiting and audit logging.
  const user = sanitize(req.headers[IDENTITY_HEADERS.user]);

  // Performance: Use lazy getters for optional identity fields to avoid redundant
  // sanitization overhead on every request (especially for static assets).
  req.identity = {
    user,
    get groups() {
      // Memoize the sanitized result by replacing the getter with a data property.
      const val = sanitize(req.headers[IDENTITY_HEADERS.groups], 1024);
      Object.defineProperty(this, 'groups', { value: val, enumerable: true, configurable: true, writable: true });
      return val;
    },
    get email() {
      const val = sanitize(req.headers[IDENTITY_HEADERS.email]);
      Object.defineProperty(this, 'email', { value: val, enumerable: true, configurable: true, writable: true });
      return val;
    },
    get name() {
      const val = sanitize(req.headers[IDENTITY_HEADERS.name]);
      Object.defineProperty(this, 'name', { value: val, enumerable: true, configurable: true, writable: true });
      return val;
    }
  };

  next();
}

/**
 * Authentication enforcement middleware – requires req.identity.user and logs the principal.
 * Typically placed after identityMiddleware and rate limiters.
 */
function requireAuth(req, res, next) {
  const user = req.identity?.user;

  // Default to requiring authentication unless explicitly in dev mode.
  // This ensures a fail-closed posture if AUTH_MODE is misconfigured.
  if (AUTH_MODE !== 'dev' && !user) {
    // Security: Log unauthorized access attempts for auditability.
    // Sanitize method, path, and IP to prevent log injection.
    // Use originalUrl to ensure the full path is logged.
    // Forensic Depth: Limit originalUrl to 1024 chars for audit logs.
    console.warn(`[audit] AUTH_FAILED: ${sanitize(req.method)} ${sanitize(req.originalUrl, 1024)} user=anonymous ip=${sanitize(req.ip)}`);
    // Security: Prevent caching of unauthorized responses to protect privacy.
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(401).json({ error: 'Missing upstream identity header (Remote-User)' });
  }

  // Audit log – principal only, never tokens.
  // Security: Sanitize method, path, and IP to prevent log injection.
  // Use originalUrl to ensure the full path is logged.
  // Forensic Depth: Limit originalUrl to 1024 chars for audit logs.
  if (user) {
    console.log(`[audit] AUTH_SUCCESS: ${sanitize(req.method)} ${sanitize(req.originalUrl, 1024)} user=${user} ip=${sanitize(req.ip)}`);
  }

  next();
}

/**
 * Combined authentication middleware for backward compatibility.
 */
function authMiddleware(req, res, next) {
  identityMiddleware(req, res, () => requireAuth(req, res, next));
}

module.exports = { identityMiddleware, requireAuth, authMiddleware, AUTH_MODE, IDENTITY_HEADERS, DEV_DEFAULTS, sanitize };
