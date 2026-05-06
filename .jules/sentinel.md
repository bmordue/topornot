# Sentinel Journal

## 2025-05-14 - Application Hardening
**Vulnerability:** Lack of basic security headers, missing rate limiting, and unvalidated input lengths.
**Learning:** For a minimal Express application, adding `helmet`, `express-rate-limit`, and basic input length validation provides a significant security boost with minimal architectural change.
**Prevention:** Always include these basic security measures in any internet-facing Express application from the start.

## 2026-04-27 - Information Disclosure via Stack Traces
**Vulnerability:** Express default error handler leaks full stack traces and internal file paths in HTML format when parsing invalid JSON or when payloads are too large.
**Learning:** Middleware errors (like those from `express.json()`) bypass standard route error handling and fall through to the default Express handler unless a global error handler is explicitly defined.
**Prevention:** Always implement a terminal global error handler in Express to catch middleware exceptions and return safe, generic JSON responses.

## 2026-04-30 - Log and Header Injection Mitigation
**Vulnerability:** Identity headers (Remote-User) were logged directly without sanitization, and query parameters (status) were reflected in ETag headers without strict validation.
**Learning:** Even trust-worthy headers from an upstream proxy can contain malicious characters (like CRLF) if the proxy is misconfigured or bypassed. Query parameters reflected in response headers are high-risk sinks for injection.
**Prevention:** Always sanitize any external input before it reaches a log or a response header sink. Use strict whitelisting for parameters that influence header values.

## 2026-05-02 - Identity-Aware Rate Limiting and Global 404 Handling
**Vulnerability:** IP-based rate limiting was easily bypassable in multi-user environments (NAT), and non-API routes leaked Express default HTML error pages.
**Learning:** Authenticated user identifiers should take precedence over IP addresses for rate limiting keys to ensure fairness and prevent bypasses. Global catch-all handlers for 404s should use generic plain-text or JSON responses to minimize footprint.
**Prevention:** Always prioritize principal identifiers for rate limiting and implement terminal 404 handlers to replace default server error pages.
## 2026-05-20 - Custom 404 Handler to Prevent Information Disclosure
**Vulnerability:** Express default 404 pages leak information about the underlying technology stack (Express version, "Cannot GET /path" format) in HTML, which can be used for fingerprinting.
**Learning:** While `/api` routes had a custom 404 handler, other routes fell back to the Express default. A terminal catch-all middleware is necessary to ensure consistent, secure, and minimal responses for all non-matching paths.
**Prevention:** Implement a terminal catch-all middleware at the end of the middleware stack (before the error handler) that returns a plain-text '404 Not Found' response for any non-matching routes.

## 2026-05-25 - Upstream Identity Header Truncation
**Vulnerability:** Identity headers (Remote-User, etc.) were sanitized for CRLF but not for length, potentially allowing resource exhaustion (DoS) or log bloat via oversized values.
**Learning:** Even when using an upstream proxy for authentication, we must treat injected headers as untrusted input. Oversized headers can consume excessive memory during parsing or cause disk space issues in audit logs.
**Prevention:** Always enforce strict length limits on identity headers in the authentication middleware, truncating values to sensible defaults (e.g., 255 for identifiers, 1024 for group lists).

## 2026-05-05 - Strict CSP without unsafe-inline styles
**Vulnerability:** Default CSP from `helmet` allowed `unsafe-inline` for styles and `data:` for images, which are common vectors for XSS and data exfiltration.
**Learning:** Modern SPAs can often run without `unsafe-inline` styles even if they use JavaScript to manipulate CSS (like `element.style.transform`). Direct style manipulation via JS properties is allowed by most browsers under `style-src 'self'` if the script itself is trusted.
**Prevention:** Always aim for the strictest possible CSP. Test without 'unsafe-inline' styles first; only enable it if third-party libraries or legacy code absolutely require it.

## 2026-05-06 - Transitive Dependency Hardening and Action Rate Limiting
**Vulnerability:** Vulnerable transitive dependencies (ip-address) and lack of rate limiting on state-changing API endpoints (PATCH).
**Learning:** Upgrading a top-level package doesn't always resolve vulnerabilities in its dependencies if they use restrictive version ranges. Using the 'overrides' field in package.json is an effective way to force-patch these vulnerabilities. Additionally, high-integrity operations like approving/rejecting suggestions should have stricter rate limits than general GET requests.
**Prevention:** Regularly audit transitive dependencies and apply overrides for unpatched sub-dependencies. Ensure all state-changing endpoints have specific rate limiters.
