# Project: topornot

Approval queue for agent suggestions.

## Tech stack
- Node.js + Express
- Jest + Supertest for testing
- JSON file database (db.js)

## Commands
- `npm test` — run Jest tests
- `npm start` — start the server
- `npm run dev` — start with --watch

## Notes
- No build step (plain JS, no TypeScript)
- Tests use a temp JSON file in /tmp via `DB_PATH` env var
- No linter/formatter configured
