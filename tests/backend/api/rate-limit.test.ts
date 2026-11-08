import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http, { type Server } from 'node:http';
import { loginLimiter } from '../../../server/rate-limit';

/**
 * Raw node http request.
 *
 * AI Agent Note: the backend suite runs under happy-dom, whose fetch() enforces the
 * same-origin policy and refuses a request to 127.0.0.1:<ephemeral port>. Talking to
 * the throwaway server with node:http avoids that without changing the test env.
 */
function post(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(path, baseUrl);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk as Buffer));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: any = undefined;
          try {
            json = text ? JSON.parse(text) : undefined;
          } catch {
            json = text;
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

describe('loginLimiter', () => {
  const app = express();
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    app.use(express.json());
    app.post('/api/login', loginLimiter, (_req, res) => {
      res.status(400).json({ message: 'Invalid username or password' });
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const attempt = () =>
    post(baseUrl, '/api/login', { username: 'x', password: 'y' });

  it('answers 429 after ten failed attempts from one client', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await attempt()).status);
    }

    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);

    const body = (await attempt()).json;
    expect(body.message).toBe('Too many failed login attempts');
    expect(body.suggestion).toBeTruthy();
  });
});
