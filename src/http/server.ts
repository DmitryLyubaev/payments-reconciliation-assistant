import { createServer as nodeServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';
import { idSchema, type Fixture } from '../domain/contracts.js';
import { importFixture, loadSnapshot } from '../storage/imports.js';
import type { Store } from '../storage/store.js';
import type { FakeScript, DecisionRequest } from '../investigation/contracts.js';
import type { Workflow } from '../workflow/graph.js';
import { recordDecision } from '../workflow/decisions.js';
import type { Runner } from '../workflow/runner.js';
import { getReviewView } from './views.js';
export type DemoFixture = { id: string; label: string; data: Fixture; script: FakeScript };
export type HttpDeps = {
  store: Store;
  workflow: Workflow;
  runner: Runner;
  fixtures: DemoFixture[];
  port?: number;
  assetDir?: string;
  runtimeMode?: 'fake/scripted' | 'anthropic';
  modelVersion?: string;
};
export type RunningServer = { origin: string; close(): Promise<void> };
function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(data));
}
function body(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers['content-length'] ?? 0) > 32768) {
    req.resume();
    return Promise.reject(new Error('PAYLOAD_TOO_LARGE'));
  }
  return new Promise((resolve, reject) => {
    let size = 0,
      failed = false;
    let chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 32768) {
        if (!failed) {
          failed = true;
          chunks = [];
          reject(new Error('PAYLOAD_TOO_LARGE'));
        }
      } else if (!failed) chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('BAD_JSON'));
      }
    });
    req.on('error', reject);
  });
}
export async function createServer(deps: HttpDeps): Promise<RunningServer> {
  const token = randomBytes(32).toString('hex');
  let port = deps.port ?? 4313;
  const assets = deps.assetDir ?? fileURLToPath(new URL('../ui/', import.meta.url));
  const server = nodeServer((req, res) => void handle(req, res));
  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const host = req.headers.host;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
        throw new Error('FORBIDDEN');
      const url = new URL(req.url ?? '/', `http://${host}`),
        path = url.pathname;
      if (req.method !== 'GET') {
        const supplied = req.headers['x-session-token'];
        const bytes = Buffer.from(typeof supplied === 'string' ? supplied : '');
        if (
          bytes.length !== token.length ||
          !timingSafeEqual(bytes, Buffer.from(token)) ||
          (req.headers.origin && req.headers.origin !== `http://${host}`)
        )
          throw new Error('FORBIDDEN');
      }
      if (req.method === 'GET' && path === '/api/session')
        return json(res, 200, {
          token,
          mode: deps.runtimeMode ?? 'fake/scripted',
          modelVersion: deps.modelVersion ?? 'fake-scripted-v1',
          reviewer: 'demo-reviewer',
        });
      if (req.method === 'GET' && path === '/api/fixtures')
        return json(
          res,
          200,
          deps.fixtures.map((f) => ({
            id: f.id,
            label: f.label,
            batchIds: [...new Set(f.data.sources.map((s) => s.batchId))],
          })),
        );
      if (req.method === 'POST' && path === '/api/imports') {
        const data = z.strictObject({ fixtureId: idSchema }).parse(await body(req));
        const fixture = deps.fixtures.find((f) => f.id === data.fixtureId);
        if (!fixture) throw new Error('NOT_FOUND');
        const result = importFixture(deps.store, fixture.data);
        return json(res, result.status === 'rejected' ? 409 : 200, result);
      }
      let match = path.match(/^\/api\/batches\/([A-Za-z0-9_-]{1,64})\/receipts$/);
      if (req.method === 'GET' && match) {
        const rows = deps.store.db
          .prepare('SELECT receipt_id FROM receipt_heads WHERE batch_id=? ORDER BY receipt_id')
          .all(match[1]) as { receipt_id: string }[];
        return json(
          res,
          200,
          rows.map((r) =>
            getReviewView(deps.store, match![1], r.receipt_id, {
              identity: deps.workflow.identity,
            }),
          ),
        );
      }
      match = path.match(
        /^\/api\/batches\/([A-Za-z0-9_-]{1,64})\/receipts\/([A-Za-z0-9_-]{1,64})\/(review|investigations)$/,
      );
      if (match) {
        if (req.method === 'GET' && match[3] === 'review') {
          const threadId = url.searchParams.has('threadId')
            ? idSchema.parse(url.searchParams.get('threadId'))
            : undefined;
          return json(
            res,
            200,
            getReviewView(deps.store, match[1], match[2], {
              threadId,
              identity: deps.workflow.identity,
            }),
          );
        }
        if (req.method === 'POST' && match[3] === 'investigations') {
          z.strictObject({}).parse(await body(req));
          const snapshot = loadSnapshot(deps.store, match[1], match[2]);
          const fixture = deps.fixtures.find((f) =>
            f.data.sources.some(
              (s) => s.batchId === snapshot.batchId && s.receiptId === snapshot.receiptId,
            ),
          );
          if (!fixture) throw new Error('NOT_FOUND');
          const running = deps.workflow.begin(snapshot, fixture.script);
          void running.completion.catch(() => {});
          return json(res, 202, { threadId: running.threadId });
        }
      }
      match = path.match(/^\/api\/evidence\/(source|policy)\/([A-Za-z0-9_-]{1,64})\/([0-9]+)$/);
      if (req.method === 'GET' && match) {
        const version = Number(match[3]);
        if (!Number.isSafeInteger(version) || version <= 0) throw new Error('NOT_FOUND');
        const table = match[1] === 'source' ? 'source_versions' : 'policy_versions';
        const row = deps.store.db
          .prepare(`SELECT payload FROM ${table} WHERE id=? AND version=?`)
          .get(match[2], version) as { payload: string } | undefined;
        if (!row) throw new Error('NOT_FOUND');
        return json(res, 200, JSON.parse(row.payload));
      }
      if (req.method === 'POST' && path === '/api/decisions') {
        const receipt = recordDecision(deps.store, (await body(req)) as DecisionRequest);
        void deps.runner.wake().catch(() => {});
        return json(res, 200, receipt);
      }
      if (req.method === 'GET' && ['/', '/assets/client.js', '/assets/styles.css'].includes(path)) {
        const name = path === '/' ? 'index.html' : path.slice('/assets/'.length);
        const content = await readFile(join(assets, name));
        res.writeHead(200, {
          'content-type': path.endsWith('.js')
            ? 'text/javascript; charset=utf-8'
            : path.endsWith('.css')
              ? 'text/css; charset=utf-8'
              : 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        return res.end(content);
      }
      throw new Error('NOT_FOUND');
    } catch (error) {
      req.resume();
      const code =
        error instanceof z.ZodError
          ? 'INVALID_REQUEST'
          : error instanceof Error
            ? error.message
            : 'INTERNAL_ERROR';
      const status =
        code === 'FORBIDDEN'
          ? 403
          : code === 'NOT_FOUND'
            ? 404
            : code === 'PAYLOAD_TOO_LARGE'
              ? 413
              : ['CONFLICT', 'STALE', 'INELIGIBLE'].includes(code)
                ? 409
                : ['BAD_JSON', 'INVALID_REQUEST', 'INVALID_DECISION'].includes(code)
                  ? 400
                  : 500;
      if (!res.headersSent) json(res, status, { error: status === 500 ? 'INTERNAL_ERROR' : code });
      else res.end();
    }
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('LISTEN_FAILED');
  port = address.port;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
