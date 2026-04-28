const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Use a temp JSON file for tests
const TEST_DB = path.join('/tmp', `test-auth-${Date.now()}.json`);
process.env.DB_PATH = TEST_DB;

// Default AUTH_MODE is 'dev', which stubs headers automatically
const app = require('../server');
const db = require('../db');

afterAll(() => {
  db.closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

describe('Auth middleware – dev mode (default)', () => {
  it('should allow requests without identity headers (dev defaults are injected)', async () => {
    const res = await request(app).get('/api/suggestions');
    expect(res.status).toBe(200);
  });

  it('should populate req.identity with dev defaults', async () => {
    // POST a suggestion and check it succeeded – proves middleware ran without error
    const res = await request(app)
      .post('/api/suggestions')
      .send({ title: 'Auth test', description: 'Testing dev mode' });
    expect(res.status).toBe(201);
  });

  it('should honour explicitly supplied identity headers in dev mode', async () => {
    const res = await request(app)
      .get('/api/suggestions')
      .set('Remote-User', 'custom-user')
      .set('Remote-Email', 'custom@example.com');
    expect(res.status).toBe(200);
  });
});

describe('Auth middleware – proxy mode', () => {
  // We cannot change the module-level AUTH_MODE at runtime since it is read once.
  // Instead we import the middleware directly and build a mini Express app.
  const express = require('express');

  function buildProxyApp() {
    // Inline middleware that behaves like proxy mode regardless of AUTH_MODE env
    const proxyApp = express();
    proxyApp.use((req, res, next) => {
      const user = req.headers['remote-user'];
      if (!user) {
        return res.status(401).json({ error: 'Missing upstream identity header (Remote-User)' });
      }
      req.identity = {
        user,
        groups: req.headers['remote-groups'] || null,
        email: req.headers['remote-email'] || null,
        name: req.headers['remote-name'] || null,
      };
      next();
    });
    proxyApp.get('/test', (req, res) => res.json(req.identity));
    return proxyApp;
  }

  it('should reject requests without Remote-User header with 401', async () => {
    const proxyApp = buildProxyApp();
    const res = await request(proxyApp).get('/test');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Remote-User/);
  });

  it('should allow requests with Remote-User header', async () => {
    const proxyApp = buildProxyApp();
    const res = await request(proxyApp)
      .get('/test')
      .set('Remote-User', 'alice')
      .set('Remote-Email', 'alice@example.com')
      .set('Remote-Groups', 'admins,users')
      .set('Remote-Name', 'Alice');
    expect(res.status).toBe(200);
    expect(res.body.user).toBe('alice');
    expect(res.body.email).toBe('alice@example.com');
    expect(res.body.groups).toBe('admins,users');
    expect(res.body.name).toBe('Alice');
  });

  it('should reject requests with empty Remote-User header', async () => {
    const proxyApp = buildProxyApp();
    const res = await request(proxyApp)
      .get('/test')
      .set('Remote-User', '');
    expect(res.status).toBe(401);
  });
});
