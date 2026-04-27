# Sentinel Journal

## 2025-05-14 - Application Hardening
**Vulnerability:** Lack of basic security headers, missing rate limiting, and unvalidated input lengths.
**Learning:** For a minimal Express application, adding `helmet`, `express-rate-limit`, and basic input length validation provides a significant security boost with minimal architectural change.
**Prevention:** Always include these basic security measures in any internet-facing Express application from the start.

## 2026-04-27 - Information Disclosure via Stack Traces
**Vulnerability:** Express default error handler leaks full stack traces and internal file paths in HTML format when parsing invalid JSON or when payloads are too large.
**Learning:** Middleware errors (like those from `express.json()`) bypass standard route error handling and fall through to the default Express handler unless a global error handler is explicitly defined.
**Prevention:** Always implement a terminal global error handler in Express to catch middleware exceptions and return safe, generic JSON responses.
