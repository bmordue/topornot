# Future Development Plan

This document tracks potential improvements, features, and technical work for topornot.

## Near-term

- **Persistent storage** – Replace the JSON file database with SQLite (via `better-sqlite3`) or PostgreSQL so the data survives container restarts and supports concurrent access without file-locking issues.
- **Authentication** – Add API key or JWT-based authentication so only trusted agents can submit suggestions and only authorised reviewers can act on them.
- **Pagination** – The `GET /api/suggestions` endpoint currently returns all matching records. Add `limit` / `offset` (or cursor-based) pagination for large queues.
- **Bulk actions** – Allow approving or rejecting multiple suggestions in a single request to speed up human review.
- **Webhook / event notifications** – Emit events when a suggestion changes status so downstream systems (CI pipelines, Slack bots, etc.) can react immediately.

## Medium-term

- **Priority levels** – Allow agents to tag a suggestion as `low`, `normal`, or `high` priority, with the UI surfacing high-priority items first.
- **Categories / labels** – Let agents attach free-form labels (e.g. `security`, `performance`, `ux`) so reviewers can filter by topic.
- **Comments** – Allow reviewers to leave a short comment when approving or rejecting, providing an audit trail and feedback loop for agents.
- **Multi-reviewer workflow** – Support a configurable quorum so that a suggestion requires N approvals before it is marked `approved`.
- **Agent management UI** – Dashboard page to register agents, view their submission history, and revoke access.
- **Audit log** – Record every status transition with the reviewer identity and timestamp for compliance and debugging.

## Longer-term

- **Docker Compose setup** – Provide a `docker-compose.yml` with the app and a database service so the full stack can be started with a single command.
- **CI/CD pipeline** – GitHub Actions workflow to run tests, lint, and optionally publish a container image on every push to `main`.
- **Rate limiting** – Prevent a misbehaving agent from flooding the queue by applying per-agent or per-IP rate limits.
- **Suggestion expiry** – Automatically expire `pending` suggestions after a configurable TTL so stale items don't accumulate indefinitely.
- **Metrics endpoint** – Expose a `/metrics` endpoint (Prometheus format) with counters for suggestions created, approved, rejected, and deferred.
- **Internationalisation (i18n)** – Localise the UI for non-English speakers.
- **Dark mode** – Honour the `prefers-color-scheme` media query and add a manual toggle.
- **Accessibility audit** – Ensure full keyboard navigation, correct ARIA roles, and sufficient colour contrast for WCAG 2.1 AA compliance.
