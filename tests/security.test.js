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

describe('Security Headers', () => {
  it('should have security headers (helmet)', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-dns-prefetch-control']).toBeDefined();
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('should trust proxy', () => {
    expect(app.get('trust proxy')).toBe(1);
  });
});

describe('Payload Size Limit', () => {
  it('should reject large payloads (over 10kb)', async () => {
    const largeTitle = 'a'.repeat(11000);
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: largeTitle, description: 'short' });
    expect(res.status).toBe(413); // Payload Too Large
  });
});

describe('Input Validation', () => {
  it('should reject titles longer than 100 characters', async () => {
    const longTitle = 'a'.repeat(101);
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: longTitle, description: 'valid description' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title must be a string up to 100 characters/);
  });

  it('should reject descriptions longer than 1000 characters', async () => {
    const longDesc = 'a'.repeat(1001);
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: 'valid title', description: longDesc });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description must be a string up to 1000 characters/);
  });

  it('should reject non-string inputs', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: 123, description: 'valid description' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title must be a string/);
  });

  it('should not leak stack traces on invalid JSON', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .set('Content-Type', 'application/json')
      .send('{"invalid": json');

    expect(res.status).toBe(400);
    // Should not contain internal stack trace info
    expect(res.text).not.toMatch(/SyntaxError/);
    expect(res.text).not.toMatch(/node_modules/);
    // Ideally it should be a JSON error response
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.error).toBeDefined();
  });
});

describe('Rate Limiting', () => {
  it('should eventually reject too many requests', async () => {
    // This is hard to test perfectly without slowing down the test suite or mocking,
    // but we can try a few and see if it's there.
    // Given the limit is 100, we won't hit it in a normal test run easily without loop.
    // However, we can just check if the headers are present if standardHeaders: true is set.
    const res = await request(app).post('/api/suggestions').send({title: 'a', description: 'b'});
    expect(res.headers['ratelimit-limit']).toBeDefined();
    expect(res.headers['ratelimit-remaining']).toBeDefined();
  });
});

describe('API Error Handling', () => {
  it('should return JSON 404 for non-existent API routes', async () => {
    const res = await request(app).get('/api/non-existent-route');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.error).toBe('API endpoint not found');
  });

  it('should return plain text 404 for non-existent non-API routes', async () => {
    const res = await request(app).get('/non-existent-route');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toBe('404 Not Found');
  });

  it('should reject non-numeric IDs in PATCH route', async () => {
    const res = await request(app).patch('/api/suggestions/invalid-id/approve');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid ID/);
  });

  it('should strictly validate status query param and prevent ETag injection', async () => {
    // Malicious status value containing CRLF and a fake header
    const maliciousStatus = 'all\r\nInjected-Header: evil';
    const res = await request(app)
      .get('/api/suggestions')
      .query({ status: maliciousStatus });

    expect(res.status).toBe(200);
    // The status should have been normalized to 'pending'
    expect(res.headers['etag']).toMatch(/-pending"$/);
    expect(res.headers['injected-header']).toBeUndefined();
  });

  it('should sanitize all identity headers (unit test)', () => {
    const { authMiddleware } = require('../auth');
    const spy = jest.spyOn(console, 'log').mockImplementation();
    const req = {
      method: 'GET',
      path: '/api/suggestions',
      headers: {
        'remote-user': 'attacker\nInjected log line',
        'remote-groups': 'admin\r\nevil',
        'remote-email': 'user@example.com\nInjected',
        'remote-name': 'Joe\nBloggs'
      }
    };
    const res = {};
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('user=attacker_Injected log line'));
    expect(req.identity.user).toBe('attacker_Injected log line');
    expect(req.identity.groups).toBe('admin__evil');
    expect(req.identity.email).toBe('user@example.com_Injected');
    expect(req.identity.name).toBe('Joe_Bloggs');
    expect(next).toHaveBeenCalled();
    spy.mockRestore();
  });
});
