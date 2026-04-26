const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Use a temp JSON file for tests
const TEST_DB = path.join('/tmp', `test-security-${Date.now()}.json`);
process.env.DB_PATH = TEST_DB;

const app = require('../server');
const db = require('../db');

afterAll(() => {
  db.closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

describe('Security: Input Validation and Rate Limiting', () => {
  it('rejects suggestions with titles that are too long (>100 chars)', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({
        title: 'a'.repeat(101),
        description: 'valid description'
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/);
  });

  it('rejects suggestions with descriptions that are too long (>1000 chars)', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({
        title: 'valid title',
        description: 'a'.repeat(1001)
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description/);
  });

  it('rejects suggestions with context that is too long (>5000 chars)', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({
        title: 'valid title',
        description: 'valid description',
        context: 'a'.repeat(5001)
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/context/);
  });

  it('rejects suggestions with agent names that are too long (>100 chars)', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({
        title: 'valid title',
        description: 'valid description',
        agent: 'a'.repeat(101)
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/agent/);
  });

  it('rejects payloads that exceed the 10kb limit', async () => {
    // Generate a payload slightly larger than 10kb
    // Each char is 1 byte in UTF-8 for these simple chars
    const largeContext = 'a'.repeat(11000);
    const res = await request(app)
      .post('/api/suggestions')
      .send({
        title: 'valid title',
        description: 'valid description',
        context: largeContext
      });
    // Express returns 413 Payload Too Large when the limit is exceeded
    expect(res.status).toBe(413);
  });
});
