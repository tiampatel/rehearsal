// CampusFix app factory and entry point (task: api). See API.md "App factory".
// Importing this module never starts a server; running it (npm start) does.

import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DB_PATH,
  DEFAULT_HOST,
  DEFAULT_PORT,
  ENV,
  ERROR_CODES,
} from '../shared/contract.js';
import { createApiHandler, sendError } from './api.js';
import { openStore } from './store.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PUBLIC_DIR = join(REPO_ROOT, 'public');
const SHARED_DIR = join(REPO_ROOT, 'shared');

const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
});

const staticNotFound = (res) => sendError(res, 404, ERROR_CODES.notFound, 'Resource not found');

// Maps a URL pathname to a file inside `rootDir`, or returns null when it would escape the root,
// contains hidden segments, or is not a regular file.
async function resolveStaticFile(rootDir, relativePath) {
  let decoded;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;

  const segments = decoded.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.startsWith('.'))) {
    return null;
  }

  let realRoot;
  let realFile;
  try {
    realRoot = await realpath(rootDir);
    realFile = await realpath(join(realRoot, ...segments));
  } catch {
    return null;
  }
  if (realFile !== realRoot && !realFile.startsWith(realRoot + sep)) return null;

  try {
    const info = await stat(realFile);
    return info.isFile() ? realFile : null;
  } catch {
    return null;
  }
}

function createStaticHandler(publicDir) {
  return async function serveStatic(req, res) {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      sendError(res, 405, ERROR_CODES.methodNotAllowed, 'Method not allowed; use GET or HEAD', undefined, {
        Allow: 'GET, HEAD',
      });
      return;
    }

    let pathname;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      staticNotFound(res);
      return;
    }

    let file = null;
    if (pathname === '/') {
      file = await resolveStaticFile(publicDir, 'index.html');
    } else if (pathname.startsWith('/shared/')) {
      file = await resolveStaticFile(SHARED_DIR, pathname.slice('/shared/'.length));
    } else {
      file = await resolveStaticFile(publicDir, pathname);
    }
    if (!file) {
      staticNotFound(res);
      return;
    }

    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(method === 'HEAD' ? undefined : body);
  };
}

export function createApp({
  dbPath = process.env[ENV.dbPath] || DEFAULT_DB_PATH,
  publicDir = DEFAULT_PUBLIC_DIR,
  host = DEFAULT_HOST,
} = {}) {
  const store = openStore(dbPath);
  const handleApi = createApiHandler(store);
  const serveStatic = createStaticHandler(publicDir);

  const server = createServer(async (req, res) => {
    try {
      if (await handleApi(req, res)) return;
      await serveStatic(req, res);
    } catch (error) {
      console.error('CampusFix server internal error:', error);
      if (res.headersSent) res.destroy();
      else sendError(res, 500, ERROR_CODES.internal, 'Internal server error');
    }
  });

  let started = null; // Promise<{port,url}> once start() has been called
  let stopped = null; // Promise<void> once stop() has been called

  function start(port = 0) {
    if (stopped) return Promise.reject(new Error('App has been stopped'));
    if (started) return started;
    started = new Promise((resolveStart, rejectStart) => {
      const onError = (error) => {
        started = null;
        rejectStart(error);
      };
      server.once('error', onError);
      server.listen(port, host, () => {
        server.off('error', onError);
        const address = server.address();
        resolveStart({ port: address.port, url: `http://${host}:${address.port}` });
      });
    });
    return started;
  }

  function stop() {
    if (stopped) return stopped;
    stopped = new Promise((resolveStop, rejectStop) => {
      const finish = () => {
        try {
          store.close();
          resolveStop();
        } catch (error) {
          rejectStop(error);
        }
      };
      if (!server.listening) {
        finish();
        return;
      }
      server.close(finish);
      server.closeAllConnections();
    });
    return stopped;
  }

  return { store, server, start, stop };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const port = Number(process.env[ENV.port]) || DEFAULT_PORT;
  const app = createApp();
  try {
    const { url } = await app.start(port);
    console.log(`CampusFix listening on ${url}`);
  } catch (error) {
    console.error(`CampusFix failed to start on port ${port}: ${error.message}`);
    await app.stop();
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down`);
    try {
      await app.stop();
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
