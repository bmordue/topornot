const fc = require('fast-check');
const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Use a temp JSON file for tests
const TEST_DB = path.join('/tmp', `test-property-${Date.now()}.json`);
process.env.DB_PATH = TEST_DB;

const app = require('../server');
const db = require('../db');

afterAll(() => {
  db.closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

// ── db.js property tests ──

describe('Property: createSuggestion', () => {
  it('always returns a suggestion with pending status and incremented id', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 1000 }),
        (title, description) => {
          const s = db.createSuggestion({ title, description });
          expect(s.status).toBe('pending');
          expect(typeof s.id).toBe('number');
          expect(s.title).toBe(title);
          expect(s.description).toBe(description);
          expect(s.created_at).toBeDefined();
          expect(s.updated_at).toBeDefined();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('produces strictly increasing IDs', () => {
    let lastId = 0;
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (title, desc) => {
          const s = db.createSuggestion({ title, description: desc });
          expect(s.id).toBeGreaterThan(lastId);
          lastId = s.id;
        }
      ),
      { numRuns: 30 }
    );
  });

  it('preserves optional context and agent fields', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 1000 }),
        fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
        fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
        (title, description, context, agent) => {
          const s = db.createSuggestion({ title, description, context, agent });
          if (context) {
            expect(s.context).toBe(context);
          } else {
            expect(s.context).toBeNull();
          }
          if (agent) {
            expect(s.agent).toBe(agent);
          } else {
            expect(s.agent).toBeNull();
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});

describe('Property: getSuggestionById', () => {
  it('returns the suggestion that was created', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (title, desc) => {
          const created = db.createSuggestion({ title, description: desc });
          const found = db.getSuggestionById(created.id);
          expect(found).not.toBeNull();
          expect(found.id).toBe(created.id);
          expect(found.title).toBe(title);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('returns null for non-existent IDs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: -1 }),
        (id) => {
          expect(db.getSuggestionById(id)).toBeNull();
        }
      ),
      { numRuns: 20 }
    );
  });
});

describe('Property: updateStatus', () => {
  it('status transitions are always reflected correctly', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('approved', 'rejected', 'pending'),
        (newStatus) => {
          const s = db.createSuggestion({ title: 'test', description: 'test' });
          const updated = db.updateStatus(s.id, newStatus);
          expect(updated.status).toBe(newStatus);
          // Verify getSuggestionById also reflects the change
          const fetched = db.getSuggestionById(s.id);
          expect(fetched.status).toBe(newStatus);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('returns null when updating non-existent suggestion', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: -1 }),
        fc.constantFrom('approved', 'rejected', 'pending'),
        (id, status) => {
          expect(db.updateStatus(id, status)).toBeNull();
        }
      ),
      { numRuns: 20 }
    );
  });

  it('pending cache stays consistent through status transitions', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('approved', 'rejected', 'pending'), { minLength: 1, maxLength: 5 }),
        (statuses) => {
          const s = db.createSuggestion({ title: 'cache-test', description: 'test' });
          for (const status of statuses) {
            db.updateStatus(s.id, status);
          }
          const finalStatus = statuses[statuses.length - 1];
          const pending = db.getPendingSuggestions();
          if (finalStatus === 'pending') {
            expect(pending.some(p => p.id === s.id)).toBe(true);
          } else {
            expect(pending.some(p => p.id === s.id)).toBe(false);
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});

// ── API property tests ──

describe('Property: POST /api/suggestions validation', () => {
  it('accepts any valid string title and description', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 1000 }),
        async (title, description) => {
          const res = await request(app)
            .post('/api/suggestions')
            .send({ title, description });
          expect(res.status).toBe(201);
          expect(res.body.title).toBe(title);
          expect(res.body.description).toBe(description);
          expect(res.body.status).toBe('pending');
        }
      ),
      { numRuns: 20 }
    );
  });

  it('rejects non-string title types', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.constant([])),
        async (title) => {
          const res = await request(app)
            .post('/api/suggestions')
            .send({ title, description: 'valid desc' });
          expect(res.status).toBe(400);
        }
      ),
      { numRuns: 10 }
    );
  });

  it('rejects titles longer than 100 characters', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 101, maxLength: 200 }),
        async (title) => {
          const res = await request(app)
            .post('/api/suggestions')
            .send({ title, description: 'valid desc' });
          expect(res.status).toBe(400);
          expect(res.body.error).toMatch(/title/);
        }
      ),
      { numRuns: 10 }
    );
  });

  it('rejects descriptions longer than 1000 characters', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1001, maxLength: 1100 }),
        async (description) => {
          const res = await request(app)
            .post('/api/suggestions')
            .send({ title: 'valid', description });
          expect(res.status).toBe(400);
          expect(res.body.error).toMatch(/description/);
        }
      ),
      { numRuns: 10 }
    );
  });
});

describe('Property: PATCH /api/suggestions/:id/:action', () => {
  it('valid actions always succeed on existing suggestions', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.constantFrom('approve', 'reject', 'defer'),
        async (action) => {
          // Create a suggestion first
          const created = await request(app)
            .post('/api/suggestions')
            .send({ title: 'prop-test', description: 'desc' });
          const id = created.body.id;

          const res = await request(app).patch(`/api/suggestions/${id}/${action}`);
          expect(res.status).toBe(200);
          const expectedStatus = { approve: 'approved', reject: 'rejected', defer: 'pending' };
          expect(res.body.status).toBe(expectedStatus[action]);
        }
      ),
      { numRuns: 15 }
    );
  });

  it('invalid actions always return 400', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[a-z0-9]{1,20}$/).filter(s => !['approve', 'reject', 'defer'].includes(s)),
        async (action) => {
          const created = await request(app)
            .post('/api/suggestions')
            .send({ title: 'prop-test', description: 'desc' });
          const res = await request(app).patch(`/api/suggestions/${created.body.id}/${action}`);
          expect(res.status).toBe(400);
          expect(res.body.error).toMatch(/Invalid action/);
        }
      ),
      { numRuns: 10 }
    );
  });

  it('actions on non-existent IDs return 404', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 999000, max: 999999 }),
        fc.constantFrom('approve', 'reject', 'defer'),
        async (id, action) => {
          const res = await request(app).patch(`/api/suggestions/${id}/${action}`);
          expect(res.status).toBe(404);
        }
      ),
      { numRuns: 10 }
    );
  });
});
