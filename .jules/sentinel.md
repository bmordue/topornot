# Sentinel Journal

## 2025-05-14 - Application Hardening
**Vulnerability:** Lack of basic security headers, missing rate limiting, and unvalidated input lengths.
**Learning:** For a minimal Express application, adding `helmet`, `express-rate-limit`, and basic input length validation provides a significant security boost with minimal architectural change.
**Prevention:** Always include these basic security measures in any internet-facing Express application from the start.
