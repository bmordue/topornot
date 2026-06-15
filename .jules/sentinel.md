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

## 2026-05-26 - Request Metadata Log Injection
**Vulnerability:** Request method and path were logged directly without sanitization, potentially allowing log forging or corruption via URL-encoded control characters (e.g., %0A).
**Learning:** Even though Express provides `req.path` as a convenience, it performs URL decoding, which can re-introduce malicious control characters into a string intended for a line-based log.
**Prevention:** Always sanitize any request metadata (method, path, headers) before including it in a console log or an external logging system.

## 2026-06-05 - Comprehensive Control Character Sanitization for Logs
**Vulnerability:** Sanitization that only targets CRLF leaves logs vulnerable to terminal manipulation (e.g., ANSI escape sequences) which can be used to hide, spoof, or overwrite log entries in a terminal emulator.
**Learning:** Log injection isn't just about line breaks for line-based parsers; it also encompasses terminal control codes that can maliciously alter the visual presentation of log streams.
**Prevention:** Use a broad character class like `[\x00-\x1F\x7F]` to strip all C0 control characters and the DEL character from any untrusted input (including headers and IP addresses) before it reaches a log sink.

## 2026-05-12 - Fail-Closed Authentication Configuration
**Vulnerability:** The authentication middleware was using a "fail-open" pattern where it only enforced identity header checks if `AUTH_MODE` was explicitly set to 'proxy'. Any other value (due to typos or misconfiguration) would allow unauthenticated access.
**Learning:** Defaulting to a bypass state for unknown configurations is dangerous. Security-sensitive middleware should always default to its most restrictive state.
**Prevention:** Use "fail-closed" logic by checking for the bypass condition (e.g., `AUTH_MODE === 'dev'`) and requiring authentication for all other values.

## 2026-05-14 - Hardened CSP for Standalone API Applications
**Vulnerability:** Default CSP from `helmet` allows embedding in frames (clickjacking) and doesn't restrict `base-uri` or `form-action`, which can be exploited if an XSS or HTML injection vulnerability is present.
**Learning:** For standalone PWAs that interact exclusively via `fetch` and do not use traditional HTML forms or `<base>` tags, CSP can be significantly tightened beyond defaults to provide defense-in-depth against clickjacking and data exfiltration.
**Prevention:** Always explicitly set `frame-ancestors 'none'`, `base-uri 'none'`, and `form-action 'none'` for single-page applications that do not require these features.

## 2026-06-15 - Privacy Hardening and Sensitive API Cache Control
**Vulnerability:** Default `Permissions-Policy` lacks modern privacy-focused directives, and sensitive API responses may be cached by intermediaries if `Cache-Control` is not explicitly set.
**Learning:** Modern browser features like Topics API can be used for tracking even if standard cookies are blocked. Additionally, sensitive data delivered via API should always be marked as `private` and `no-cache` to prevent leaks in shared caches (CDNs, proxies).
**Prevention:** Explicitly disable privacy-tracking features (`browsing-topics`, `run-ad-auction`, `join-ad-interest-group`) in `Permissions-Policy` and always set restrictive `Cache-Control` headers for all authenticated API endpoints.

## 2026-05-17 - Service Worker Fallback Hardening
**Vulnerability:** Service Worker offline fallback responses (503) lacked security headers, making them potentially susceptible to MIME-sniffing or clickjacking if they could be influenced by external input.
**Learning:** Security headers must be applied to every response the application generates, including synthetic responses created by a Service Worker. A "secure-by-default" posture extends beyond the server-side code to the client-side proxy layer.
**Prevention:** Always include standard security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`) in synthetic responses generated by Service Workers.

## 2026-06-20 - Defense-in-Depth Hardening and Forensic Auditability
**Vulnerability:** Default static file serving might expose sensitive dotfiles (e.g., .env), and audit logs lacked source IP addresses, hindering forensic investigation of security events.
**Learning:** Hardening static file serving and implementing comprehensive IP logging across all state-changing and authenticated operations provides a critical layer of defense-in-depth and accountability. A "deny-by-default" CSP (default-src 'none') further minimizes the attack surface.
**Prevention:** Explicitly configure static middleware to deny dotfiles, and always include sanitized source IP addresses in all security-relevant log entries to ensure forensic traceability.

## 2026-06-25 - Comprehensive Security Headers for Service Worker Synthetic Responses
**Vulnerability:** Service Worker offline fallback responses were missing critical modern security headers (CSP, COOP, COEP, CORP), creating a security disparity between online and offline states.
**Learning:** Hardening only the server-side responses is insufficient when a Service Worker can generate synthetic responses. These synthetic responses must mirror the security posture of the server to prevent them from becoming a weaker link in the defense-in-depth chain.
**Prevention:** Always define a comprehensive set of security headers for any synthetic Response object created in a Service Worker, including a strict Content-Security-Policy and cross-origin isolation policies.

## 2026-05-27 - Restrictive Database File Permissions
**Vulnerability:** The JSON database file was created with default system permissions, potentially allowing other local users to read sensitive suggestion data.
**Learning:** The `mode` option in Node.js `fs.writeFileSync` only applies when a file is newly created. If the file already exists (e.g., created by another process or `touch`), its permissions are not modified by `writeFileSync`.
**Prevention:** Explicitly call `fs.chmodSync(path, 0o600)` after writing to ensure permissions are hardened even for existing files.

## 2026-05-27 - Defensive Sanitization for DoS Mitigation
**Vulnerability:** Sanitization logic that processes untrusted input of arbitrary length before truncation can be susceptible to resource exhaustion (DoS).
**Learning:** Truncating input strings to a sensible maximum length *before* performing complex operations like regex replacement significantly reduces the attack surface and ensures predictable performance.
**Prevention:** Always apply strict length limits to untrusted input as the very first step of sanitization to protect downstream processing logic.

## 2026-06-25 - Comprehensive Control Character Sanitization with Fast-Path Optimization
**Vulnerability:** Identity headers and other user-supplied metadata were sanitized for C0 control characters, but remained vulnerable to C1 control characters (\x80-\x9F), which can be used for advanced log spoofing or terminal manipulation in modern environments.
**Learning:** Comprehensive sanitization of all control characters (C0, C1, and DEL) is essential for robust audit logs. Furthermore, a regex-based "fast-path" check allows for efficient validation of already-clean inputs without redundant replacement operations.
**Prevention:** Always include the C1 range (\x80-\x9F) in sanitization filters and use `RegExp.test()` for optimized early returns on clean strings.

## 2026-06-28 - Hardened Unicode Sanitization for Visual Spoofing
**Vulnerability:** Sanitization that only targets common control characters (\x00-\x1F, \x7F-\x9F) leaves the application vulnerable to visual spoofing and log injection via "hidden" Unicode characters like the soft hyphen (\u00AD) and line/paragraph separators (\u2028, \u2029).
**Learning:** Modern terminal emulators and web browsers may render these characters in ways that can maliciously alter the visual interpretation of strings, potentially hiding malicious payloads or spoofing audit logs.
**Prevention:** Always include a broader set of dangerous Unicode formatting and separator characters in sanitization filters. Hoisting these regular expressions to module scope ensures that this multi-layered protection doesn't come with a significant performance penalty on the critical path.

## 2026-06-30 - Audit Logging for Rate Limit Violations
**Vulnerability:** Rate limiting without audit logging makes it difficult to detect and investigate brute-force or DoS attacks in progress.
**Learning:** Security headers (like `Cache-Control: no-store`) on 429 responses protect privacy, but server-side visibility into *who* is triggering limits and *on which endpoints* is essential for forensic auditability.
**Prevention:** Always implement descriptive audit logging within rate limit handlers, ensuring that request metadata (method, path) and principal identifiers (user, IP) are sanitized before logging to prevent injection.

## 2026-07-02 - Comprehensive Forensic Audit Logging with originalUrl
**Vulnerability:** Audit logs used `req.path`, which in Express can be truncated when using routers or mount points, potentially losing critical context like the full URL or mount prefix in catch-all handlers.
**Learning:** `req.path` is relative to the mount point of the middleware. For global audit logging and catch-all error/404 handlers, `req.originalUrl` must be used to ensure the complete request target is captured.
**Prevention:** Always use `req.originalUrl` for security-related logging to maintain full visibility of the request URI across all routing layers.

## 2026-06-04 - Atomic Persistence and Service Worker Hardening
**Vulnerability:** Potential database corruption during interrupted writes and incomplete security headers in Service Worker synthetic responses.
**Learning:** Standard `fs.writeFileSync` is not atomic; an interruption can result in a truncated or corrupted file, causing a DoS. Furthermore, Service Worker synthetic responses are often overlooked and should match the server's security posture to ensure consistent defense-in-depth.
**Prevention:** Always use a temporary file and `fs.renameSync` for atomic persistence. Explicitly define a complete set of security headers (including `frame-ancestors`, `base-uri`, and `Referrer-Policy`) for all synthetic responses generated by client-side workers.

## 2026-07-05 - Unicode Normalization and Variation Selector Sanitization
**Vulnerability:** Sanitization that only targets control characters leaves the application vulnerable to visual spoofing and homograph attacks where different Unicode representations (e.g., combining characters vs. precomposed) or invisible variation selectors are used to bypass filters or impersonate users.
**Learning:** Unicode normalization (NFKC) is critical to ensure a canonical representation of input before sanitization, and stripping Variation Selectors (U+FE00–U+FE0F) prevents the use of hidden characters that can subtly alter string appearance.
**Prevention:** Always apply `.normalize('NFKC')` to untrusted input and include Variation Selectors in the set of stripped control/invisible characters to ensure a robust "what you see is what you get" posture.

## 2026-07-06 - Reducing Browser Attack Surface via Permissions-Policy
**Vulnerability:** Modern browser APIs like Bluetooth, HID, Serial, and local fonts provide extensive system access and tracking capabilities that increase the attack surface if a site is compromised via XSS.
**Learning:** Most web applications do not require access to hardware or low-level OS features. Leaving these enabled by default provides additional vectors for data exfiltration or system manipulation.
**Prevention:** Explicitly disable all unused browser features (including `bluetooth`, `hid`, `serial`, `display-capture`, and `local-fonts`) via a restrictive `Permissions-Policy` header to minimize the potential impact of a client-side compromise.

## 2026-07-08 - Forensic Depth Truncation for Audit Logs
**Vulnerability:** Log entries for `req.originalUrl` used a default truncation of 255 characters, which could lose critical forensic context (e.g., long query parameters or exploit payloads) during security investigations.
**Learning:** Audit logs need a balance between resource protection (preventing log DoS) and forensic utility. 255 characters is often too short for modern web request paths and parameters.
**Prevention:** Explicitly define a higher truncation limit (e.g., 1024) specifically for request identifiers in security audit logs to preserve actionable intelligence while still capping maximum line length.

## 2026-07-15 - Fail-Closed Persistence and Startup
**Vulnerability:** "Fail-open" database loading allowed the application to ignore corruption and overwrite a corrupted database with an empty state, leading to permanent data loss (DoS).
**Learning:** Security-sensitive systems must prioritize data integrity. Defaulting to an empty state on parse failure is dangerous for persistent storage.
**Prevention:** Implement "fail-closed" database loading that throws on corruption, and ensure the server explicitly validates database connectivity/integrity during its startup sequence to prevent running in an inconsistent state.

## 2026-07-20 - Security Header Parity in Service Worker
**Vulnerability:** Service Worker synthetic responses (503 Offline) were missing critical security headers (`object-src 'none'`) and comprehensive `Permissions-Policy` directives present on the server, creating a security disparity between online and offline states.
**Learning:** Security hardening must be applied consistently across all response-generating layers, including client-side workers. A browser-side proxy can be a blind spot for security posture if not audited alongside the server.
**Prevention:** Always synchronize security header configurations between the server and Service Worker synthetic responses to ensure a consistent defense-in-depth posture.

## 2026-07-22 - Multi-layered Security Posture Synchronization and Confusable Character Hardening
**Vulnerability:** Security posture disparity between server and Service Worker, and vulnerability to visual spoofing via a wider range of "invisible" or "confusable" Unicode characters.
**Learning:** Hardening only a subset of control characters leaves the application vulnerable to more advanced visual spoofing and homograph attacks using characters like Hangul fillers or specific invisible spaces. Furthermore, security headers like HSTS and CSP directives (e.g., upgrade-insecure-requests) must be synchronized across all response-generating layers, including client-side Service Workers, to maintain a consistent defense-in-depth boundary.
**Prevention:** Regularly expand sanitization filters to include newly identified confusable characters and ensure that all security header configurations are mirrored in both server-side and client-side (Service Worker) synthetic response logic.

## 2026-08-01 - Robust Request Body Validation for Non-Object Payloads
**Vulnerability:** Unhandled exceptions (500 Internal Server Error) when receiving valid but non-object JSON payloads (e.g., `null`, `[]`) that pass through middleware but fail during destructuring in route handlers.
**Learning:** Even with `express.json()`, certain valid JSON payloads like `null` or arrays can bypass initial checks and cause crashes if the code assumes the body is always a non-null object.
**Prevention:** Always validate that `req.body` is a non-null object before attempting to destructure properties in route handlers, returning a 400 Bad Request if the payload shape is incorrect.

## 2026-06-14 - Standardized Security Audit Logging for Forensic Depth
**Vulnerability:** Inconsistent and missing logging for security-relevant events (validation failures, malformed JSON, authentication failures) limited the forensic utility of logs and hindered the detection of probing or scanning activities.
**Learning:** Security logs are most effective when they share a consistent format and prefix (e.g., `[audit]`), enabling efficient filtering and monitoring. Furthermore, capturing the HTTP method and full request path (truncated but sufficient) alongside identity identifiers is essential for reconstructing malicious activity.
**Prevention:** Implement a standardized logging pattern for all security-relevant events that consistently includes sanitized forensic context: method, originalUrl (with appropriate truncation), principal identifier (user), and IP.

## 2026-07-25 - Unauthenticated Rate Limit Bypass
**Vulnerability:** Unauthenticated requests bypassed the global rate limiter because authentication enforcement was positioned before the rate limiting middleware.
**Learning:** Middleware order is critical. When authentication enforcement (401) occurs before rate limiting, malicious actors can flood the server with unauthenticated requests, potentially leading to DoS or log spam, without being throttled.
**Prevention:** Always place the rate limiter as early as possible in the middleware stack, ideally after identity extraction but before enforcement, to ensure that even rejected or unauthorized requests are subject to quotas.
