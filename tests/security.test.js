const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Use a temp JSON file for tests
const TEST_DB = path.join('/tmp', `test-security-${Date.now()}.json`);
process.env.DB_PATH = TEST_DB;

const app = require('../server');
const { PERMISSIONS_POLICY } = app;
const db = require('../db');
const { authMiddleware } = require('../auth');

afterAll(() => {
  db.closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

describe('Security Headers', () => {
  it('should have security headers (helmet)', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-dns-prefetch-control']).toBeDefined();
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['strict-transport-security']).toMatch(/preload/);
    expect(res.headers['cross-origin-embedder-policy']).toBe('require-corp');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-permitted-cross-domain-policies']).toBe('none');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['permissions-policy']).toBe(PERMISSIONS_POLICY);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');

    const csp = res.headers['content-security-policy'];
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).toMatch(/script-src 'self'/);
    expect(csp).toMatch(/style-src 'self'/);
    expect(csp).toMatch(/img-src 'self'/);
    expect(csp).toMatch(/connect-src 'self'/);
    expect(csp).toMatch(/manifest-src 'self'/);
    expect(csp).toMatch(/worker-src 'self'/);
    expect(csp).toMatch(/font-src 'none'/);
    expect(csp).toMatch(/script-src-attr 'none'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/base-uri 'none'/);
    expect(csp).toMatch(/form-action 'none'/);
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

  it('should set Cache-Control: no-store on route-level validation errors', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ description: 'missing title' }); // Triggers 400
    expect(res.status).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store, max-age=0');
  });

  it('should not leak stack traces on invalid JSON and set no-store', async () => {
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
    expect(res.headers['cache-control']).toBe('no-store, max-age=0');
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

  it('should include rate limiting headers on PATCH route', async () => {
    const res = await request(app).patch('/api/suggestions/1/approve');
    expect(res.headers['ratelimit-limit']).toBeDefined();
    expect(res.headers['ratelimit-remaining']).toBeDefined();
  });

  it('should set Cache-Control: no-store and log audit entry on 429 rate limit responses', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    // We'll trigger the limiter by making many requests.
    // Use a unique user to avoid affecting other tests.
    const uniqueUser = `rate-limit-user-${Date.now()}`;
    const promises = [];
    for (let i = 0; i < 105; i++) {
      promises.push(request(app)
        .post('/api/suggestions')
        .set('Remote-User', uniqueUser)
        .send({ title: 'rate', description: 'limit' }));
    }
    const results = await Promise.all(promises);
    const tooManyRequests = results.find(r => r.status === 429);

    expect(tooManyRequests).toBeDefined();
    expect(tooManyRequests.headers['cache-control']).toBe('no-store, max-age=0');
    expect(tooManyRequests.body.error).toMatch(/Too many suggestions/);

    // Verify audit log
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/\[audit\] RATE_LIMIT_EXCEEDED: POST \/api\/suggestions user=rate-limit-user-\d+ ip=[a-f\d\.:]+/));
    warnSpy.mockRestore();
  });
});

describe('API Cache Control', () => {
  it('should set private, no-cache on /api/suggestions', async () => {
    const res = await request(app).get('/api/suggestions');
    expect(res.headers['cache-control']).toBe('private, no-cache, must-revalidate');
  });
});

describe('API Error Handling', () => {
  it('should return JSON 404 and log an audit entry for non-existent API routes', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const res = await request(app).get('/api/non-existent-route');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.error).toBe('API endpoint not found');
    expect(res.headers['cache-control']).toBe('no-store, max-age=0');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/\[audit\] API_NOT_FOUND: GET \/api\/non-existent-route user=dev-user ip=[a-f\d\.:]+/));
    warnSpy.mockRestore();
  });

  it('should return plain text 404 for non-existent non-API routes and set no-store', async () => {
    const res = await request(app).get('/non-existent-route');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toBe('404 Not Found');
    expect(res.headers['cache-control']).toBe('no-store, max-age=0');
  });

  it('should reject non-numeric IDs in PATCH route', async () => {
    const res = await request(app).patch('/api/suggestions/invalid-id/approve');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid ID/);
  });

  it('should reject unsafe integer IDs in PATCH route', async () => {
    // A number that is larger than Number.MAX_SAFE_INTEGER
    const unsafeId = '9007199254740992';
    const res = await request(app).patch(`/api/suggestions/${unsafeId}/approve`);
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

  it('should sanitize all identity headers and handle arrays (unit test)', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    const req = {
      method: 'GET',
      path: '/api/suggestions',
      headers: {
        'remote-user': ['attacker\nInjected log line', 'secondary-value'],
        'remote-groups': 'admin\r\nevil',
        'remote-email': 'user@example.com\nInjected',
        'remote-name': 'Joe\nBloggs'
      }
    };
    const res = {};
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('user=attacker_Injected log line'));
    expect(req.identity.user).toBe('attacker_Injected log line'); // Should take only first value and sanitize
    expect(req.identity.groups).toBe('admin__evil');
    expect(req.identity.email).toBe('user@example.com_Injected');
    expect(req.identity.name).toBe('Joe_Bloggs');
    expect(next).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should sanitize all control characters and DEL in identity headers (unit test)', () => {
    const req = {
      method: 'GET',
      path: '/api/suggestions',
      headers: {
        'remote-user': 'alice\x1b[31mRed\x1b[0m', // ANSI escape
        'remote-groups': 'admin\x00null\x7fdel',
        'remote-email': 'alice@example.com\tTab',
        'remote-name': 'Alice\x01SOH'
      }
    };
    const res = {};
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(req.identity.user).toBe('alice_[31mRed_[0m');
    expect(req.identity.groups).toBe('admin_null_del');
    expect(req.identity.email).toBe('alice@example.com_Tab');
    expect(req.identity.name).toBe('Alice_SOH');
    expect(next).toHaveBeenCalled();
  });

  it('should sanitize req.method, req.path, and req.ip in unauthorized warning log (unit test)', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation();
    const req = {
      method: 'POST\nInjected',
      path: '/api/suggestions\r\nInjected',
      originalUrl: '/api/suggestions\r\nInjected',
      ip: '127.0.0.1\nInjected',
      headers: {} // No remote-user
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn()
    };
    const next = jest.fn();

    // The auth.js module sets AUTH_MODE at load time.
    // security.test.js already requires('../server') which requires('../db') and ('./auth').
    const { AUTH_MODE } = require('../auth');

    authMiddleware(req, res, next);

    if (AUTH_MODE === 'proxy') {
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('POST_Injected /api/suggestions__Injected user=anonymous ip=127.0.0.1_Injected'));
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, max-age=0');
      expect(res.status).toHaveBeenCalledWith(401);
    }

    spy.mockRestore();
  });

  it('should sanitize req.method, req.path and req.ip in the auth log (unit test)', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    const req = {
      method: 'GET\nInjected-Method',
      originalUrl: '/api/suggestions\r\nInjected-Path',
      ip: '127.0.0.1\nInjected-IP',
      headers: {
        'remote-user': 'alice'
      }
    };
    const res = {};
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[auth] GET_Injected-Method /api/suggestions__Injected-Path user=alice ip=127.0.0.1_Injected-IP'));
    spy.mockRestore();
  });

  it('should truncate overly long identity headers (unit test)', () => {
    const req = {
      method: 'GET',
      path: '/api/suggestions',
      headers: {
        'remote-user': 'a'.repeat(300),
        'remote-groups': 'g'.repeat(1200),
        'remote-email': 'e'.repeat(300),
        'remote-name': 'n'.repeat(300)
      }
    };
    const res = {};
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(req.identity.user).toHaveLength(255);
    expect(req.identity.email).toHaveLength(255);
    expect(req.identity.name).toHaveLength(255);
    expect(req.identity.groups).toHaveLength(1024);
    expect(req.identity.user).toBe('a'.repeat(255));
    expect(req.identity.groups).toBe('g'.repeat(1024));
    expect(next).toHaveBeenCalled();
  });

  it('should sanitize control characters in suggestion inputs', async () => {
    const payload = {
      title: 'Title\nwith\nnewlines',
      description: 'Description\twith\ttabs',
      context: 'Context\x1b[31mwith\x1b[0mANSI',
      agent: 'Agent\0with\0nulls'
    };

    const res = await request(app)
      .post('/api/suggestions')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Title_with_newlines');
    expect(res.body.description).toBe('Description_with_tabs');
    expect(res.body.context).toBe('Context_[31mwith_[0mANSI');
    expect(res.body.agent).toBe('Agent_with_nulls');
  });

  it('should sanitize C1 control characters in identity headers (unit test)', () => {
    const req = {
      method: 'GET',
      path: '/api/suggestions',
      headers: {
        'remote-user': 'alice\x80C1',
        'remote-groups': 'admin\x9fC1',
        'remote-email': 'alice@example.com',
        'remote-name': 'Alice'
      }
    };
    const res = {};
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(req.identity.user).toBe('alice_C1');
    expect(req.identity.groups).toBe('admin_C1');
    expect(next).toHaveBeenCalled();
  });

  it('should sanitize dangerous Unicode BiDi and zero-width characters (unit test)', () => {
    const req = {
      method: 'GET',
      path: '/api/suggestions',
      headers: {
        'remote-user': 'admin\u202Ereversed', // RLO
        'remote-groups': 'user\u200Bname',   // ZWSP
        'remote-email': 'alice\uFEFF@example.com', // BOM
        'remote-name': 'Joe\u2066Bloggs' // LRI
      }
    };
    const res = {};
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(req.identity.user).toBe('admin_reversed');
    expect(req.identity.groups).toBe('user_name');
    expect(req.identity.email).toBe('alice_@example.com');
    expect(req.identity.name).toBe('Joe_Bloggs');
    expect(next).toHaveBeenCalled();
  });

  it('should sanitize soft hyphen and Unicode separators (unit test)', () => {
    const req = {
      method: 'GET',
      path: '/api/suggestions',
      headers: {
        'remote-user': 'alice\u00ADhyphen',
        'remote-groups': 'admin\u2028separator',
        'remote-email': 'alice\u2029paragraph@example.com',
        'remote-name': 'Alice'
      }
    };
    const res = {};
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(req.identity.user).toBe('alice_hyphen');
    expect(req.identity.groups).toBe('admin_separator');
    expect(req.identity.email).toBe('alice_paragraph@example.com');
    expect(next).toHaveBeenCalled();
  });

  it('should sanitize Mongolian Vowel Separator and invisible characters in \u2060-\u206F block (unit test)', () => {
    const req = {
      method: 'GET',
      path: '/api/suggestions',
      headers: {
        'remote-user': 'alice\u180Evowel',
        'remote-groups': 'admin\u2060wj', // Word Joiner
        'remote-email': 'alice\u206Bpop@example.com', // Pop Directional Formatting
        'remote-name': 'Alice\u206F' // Nominal Digit Shapes
      }
    };
    const res = {};
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(req.identity.user).toBe('alice_vowel');
    expect(req.identity.groups).toBe('admin_wj');
    expect(req.identity.email).toBe('alice_pop@example.com');
    expect(req.identity.name).toBe('Alice_');
    expect(next).toHaveBeenCalled();
  });
});

describe('Database File Security', () => {
  it('should harden database file permissions to 0o600 on flush', async () => {
    // Use the existing TEST_DB which the db module is already using
    if (!fs.existsSync(TEST_DB)) {
      db.createSuggestion({ title: 'Init', description: 'Init' });
      db.flush();
    }

    // Force loose permissions
    fs.chmodSync(TEST_DB, 0o644);
    expect(fs.statSync(TEST_DB).mode & 0o777).toBe(0o644);

    // Trigger a flush. We need to make it think it needs a save.
    db.createSuggestion({ title: 'Perm Test', description: 'Testing permissions' });
    db.flush();

    // Verify it was hardened
    const finalMode = fs.statSync(TEST_DB).mode & 0o777;
    expect(finalMode).toBe(0o600);
  });
});

describe('Audit Logging', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('should log an audit entry with IP when creating a suggestion', async () => {
    await request(app)
      .post('/api/suggestions')
      .send({ title: 'Audit Test', description: 'Testing logs' });

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/\[audit\] SUGGESTION_CREATE: id=\d+ user=dev-user ip=[a-f\d\.:]+/));
  });

  it('should log an audit entry with IP when updating a suggestion status', async () => {
    // First create one
    const createRes = await request(app)
      .post('/api/suggestions')
      .send({ title: 'Update Test', description: 'Testing logs' });

    const id = createRes.body.id;
    logSpy.mockClear();

    await request(app).patch(`/api/suggestions/${id}/approve`);

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/\[audit\] SUGGESTION_UPDATE: id=\d+ action=approve user=dev-user ip=[a-f\d\.:]+ status=approved/));
  });
});
