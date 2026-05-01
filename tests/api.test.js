const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Use a temp JSON file for tests
const TEST_DB = path.join('/tmp', `test-${Date.now()}.json`);
process.env.DB_PATH = TEST_DB;

const app = require('../server');
const db = require('../db');

afterAll(() => {
  db.closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

describe('GET /api/suggestions', () => {
  it('returns empty array when no suggestions exist', async () => {
    const res = await request(app).get('/api/suggestions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns only pending suggestions by default', async () => {
    const s1 = db.createSuggestion({ title: 'Pending one', description: 'desc' });
    const s2 = db.createSuggestion({ title: 'Pending two', description: 'desc' });
    db.updateStatus(s2.id, 'approved');

    const res = await request(app).get('/api/suggestions');
    expect(res.status).toBe(200);
    expect(res.body.every(s => s.status === 'pending')).toBe(true);
    expect(res.body.some(s => s.title === 'Pending one')).toBe(true);
    expect(res.body.some(s => s.title === 'Pending two')).toBe(false);
  });

  it('returns all suggestions when status=all', async () => {
    const res = await request(app).get('/api/suggestions?status=all');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body.some(s => s.status === 'approved')).toBe(true);
  });
});

describe('POST /api/suggestions', () => {
  it('creates a suggestion with required fields', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: 'New suggestion', description: 'Do something', agent: 'agent-1', context: 'Some context' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('New suggestion');
    expect(res.body.description).toBe('Do something');
    expect(res.body.agent).toBe('agent-1');
    expect(res.body.context).toBe('Some context');
    expect(res.body.status).toBe('pending');
    expect(res.body.id).toBeDefined();
  });

  it('returns 400 when title is missing', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ description: 'No title here' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/);
  });

  it('returns 400 when description is missing', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: 'No description here' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description/);
  });

  it('should track created_by and updated_by for audit logging', async () => {
    const user = 'audit-test-user';
    const postRes = await request(app)
      .post('/api/suggestions')
      .set('Remote-User', user)
      .send({ title: 'Audit Test', description: 'Testing audit logs' });

    expect(postRes.status).toBe(201);
    expect(postRes.body.created_by).toBe(user);
    expect(postRes.body.updated_by).toBe(user);

    const patchRes = await request(app)
      .patch(`/api/suggestions/${postRes.body.id}/approve`)
      .set('Remote-User', 'approver-user');

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.created_by).toBe(user);
    expect(patchRes.body.updated_by).toBe('approver-user');
  });
});

describe('PATCH /api/suggestions/:id/:action', () => {
  let suggestionId;

  beforeEach(async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: 'Test suggestion', description: 'Test desc' });
    suggestionId = res.body.id;
  });

  it('approves a suggestion', async () => {
    const res = await request(app).patch(`/api/suggestions/${suggestionId}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });

  it('rejects a suggestion', async () => {
    const res = await request(app).patch(`/api/suggestions/${suggestionId}/reject`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
  });

  it('defers a suggestion (keeps it pending)', async () => {
    const res = await request(app).patch(`/api/suggestions/${suggestionId}/defer`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  it('returns 400 for an invalid action', async () => {
    const res = await request(app).patch(`/api/suggestions/${suggestionId}/delete`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid action/);
  });

  it('returns 404 for a non-existent suggestion', async () => {
    const res = await request(app).patch('/api/suggestions/99999/approve');
    expect(res.status).toBe(404);
  });
});
