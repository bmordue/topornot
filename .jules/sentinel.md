## 2025-05-22 - Consistent Security Headers in Error Handlers
**Vulnerability:** Information leakage and increased attack surface on error pages (404, 500).
**Learning:** Standard middleware stacks can be bypassed when an error occurs or a route is not found, leading to inconsistent security headers (missing `Permissions-Policy`, `X-Robots-Tag`) if they are only set in a global middleware.
**Prevention:** Explicitly set security headers in all terminal handlers, including global error catch-alls and 404 handlers, to ensure a consistent security posture regardless of the request outcome.
