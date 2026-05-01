const request = require('supertest');
const path = require('path');
const fs = require('fs');

const TEST_DB = path.join('/tmp', `test-mutation-${Date.now()}.json`);
process.env.DB_PATH = TEST_DB;

const app = require('../server');
const db = require('../db');

afterAll(() => {
  db.closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

// -- db.js mutant killers --

describe('db: date formatting', () => {
  it('created_at is formatted as YYYY-MM-DD HH:MM:SS (19 chars)', () => {
    const s = db.createSuggestion({ title: 'date test', description: 'desc' });
    expect(s.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(s.created_at.length).toBe(19);
  });

  it('updated_at format is correct after status change', () => {
    const s = db.createSuggestion({ title: 'upd test', description: 'desc' });
    const updated = db.updateStatus(s.id, 'approved');
    expect(updated.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(updated.updated_at.length).toBe(19);
  });
});

describe('db: IDs increment', () => {
  it('successive suggestions get increasing IDs', () => {
    const s1 = db.createSuggestion({ title: 'id1', description: 'd' });
    const s2 = db.createSuggestion({ title: 'id2', description: 'd' });
    expect(s2.id).toBeGreaterThan(s1.id);
  });
});

describe('db: getSuggestionById', () => {
  it('returns the correct suggestion', () => {
    const s = db.createSuggestion({ title: 'find me', description: 'd' });
    const found = db.getSuggestionById(s.id);
    expect(found).not.toBeNull();
    expect(found.title).toBe('find me');
  });

  it('returns null for non-existent id', () => {
    expect(db.getSuggestionById(999999)).toBeNull();
  });
});

describe('db: closeDb resets state', () => {
  it('after closeDb, data is reloaded from disk on next call', () => {
    const s = db.createSuggestion({ title: 'before close', description: 'd' });
    db.closeDb();
    // After close, getting pending should reload from file and still find it
    const pending = db.getPendingSuggestions();
    expect(pending.some(p => p.id === s.id)).toBe(true);
  });

  it('closeDb actually clears cached data so disk changes are picked up', () => {
    db.createSuggestion({ title: 'cached', description: 'd' });
    const countBefore = db.getAllSuggestions().length;
    db.closeDb();
    // Write an empty DB to disk
    fs.writeFileSync(TEST_DB, JSON.stringify({ nextId: 1, suggestions: [] }), 'utf8');
    // If closeDb is a no-op, the cached data would still show old suggestions
    const countAfter = db.getAllSuggestions().length;
    expect(countAfter).toBe(0);
    expect(countAfter).toBeLessThan(countBefore);
  });
});

describe('db: _save persists data', () => {
  it('data survives close+reload cycle', () => {
    const s = db.createSuggestion({ title: 'persist test', description: 'd' });
    db.closeDb();
    const all = db.getAllSuggestions();
    expect(all.some(a => a.title === 'persist test')).toBe(true);
  });
});

describe('db: pending cache management', () => {
  it('approved suggestion not in pending list', () => {
    const s = db.createSuggestion({ title: 'to approve', description: 'd' });
    db.updateStatus(s.id, 'approved');
    const pending = db.getPendingSuggestions();
    expect(pending.some(p => p.id === s.id)).toBe(false);
  });

  it('deferred suggestion stays in pending list', () => {
    const s = db.createSuggestion({ title: 'to defer', description: 'd' });
    db.updateStatus(s.id, 'approved');
    db.updateStatus(s.id, 'pending');
    const pending = db.getPendingSuggestions();
    expect(pending.some(p => p.id === s.id)).toBe(true);
  });
});

describe('db: updateStatus early return on same status', () => {
  it('no-op when status is unchanged', () => {
    const s = db.createSuggestion({ title: 'same status', description: 'd' });
    const originalUpdatedAt = s.updated_at;
    // Force a tiny delay so updated_at would differ if it ran
    const result = db.updateStatus(s.id, 'pending');
    expect(result.updated_at).toBe(originalUpdatedAt);
  });
});

// -- server.js mutant killers --

describe('POST /api/suggestions: context validation', () => {
  it('rejects non-string context', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: 'valid', description: 'valid', context: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/context must be a string/);
  });

  it('rejects context longer than 5000 characters', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: 'valid', description: 'valid', context: 'a'.repeat(5001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/context must be a string up to 5000 characters/);
  });

  it('accepts context at exactly 5000 characters', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: 'valid', description: 'valid', context: 'a'.repeat(5000) });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/suggestions: agent validation', () => {
  it('rejects non-string agent', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: 'valid', description: 'valid', agent: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/agent must be a string/);
  });

  it('rejects agent longer than 100 characters', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: 'valid', description: 'valid', agent: 'a'.repeat(101) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/agent must be a string up to 100 characters/);
  });

  it('accepts agent at exactly 100 characters', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: 'valid', description: 'valid', agent: 'a'.repeat(100) });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/suggestions: boundary values', () => {
  it('accepts title at exactly 100 characters', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: 'a'.repeat(100), description: 'valid' });
    expect(res.status).toBe(201);
  });

  it('accepts description at exactly 1000 characters', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: 'valid', description: 'a'.repeat(1000) });
    expect(res.status).toBe(201);
  });

  it('returns 400 when both title and description are missing', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title and description are required/);
  });

  it('returns 400 when title is empty string', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: '', description: 'valid' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when description is empty string', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: 'valid', description: '' });
    expect(res.status).toBe(400);
  });

  it('rejects non-string description', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: 'valid', description: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description must be a string/);
  });
});

describe('PATCH: error body content', () => {
  it('404 response has non-empty error message', async () => {
    const res = await request(app).patch('/api/suggestions/99999/approve');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('400 for invalid action has comma-separated actions in message', async () => {
    const res = await request(app).patch('/api/suggestions/1/delete');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(', ');
  });
});

describe('Error handler: response body content', () => {
  it('invalid JSON returns non-empty error message', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .set('Content-Type', 'application/json')
      .send('{"invalid": json');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('payload too large returns non-empty error message', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: 'a'.repeat(11000), description: 'short' });
    expect(res.status).toBe(413);
    expect(res.body.error).toBeTruthy();
    expect(res.body.error.length).toBeGreaterThan(0);
  });
});

describe('Static file serving', () => {
  it('serves index.html from public directory', async () => {
    const res = await request(app).get('/index.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });
});
