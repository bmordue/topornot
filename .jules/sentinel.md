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
