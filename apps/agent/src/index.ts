import http from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';
import { buildMastra } from './mastra.js';
import { fetchAdminConfig, getCachedAdminConfig } from './admin-config.js';

buildMastra(); // Initialize Mastra (foundation stub)

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';

let adminConfigReady = false;
fetchAdminConfig(GATEWAY_URL)
  .then(() => {
    adminConfigReady = true;
    logger.info('admin config loaded — agent ready for requests');
  })
  .catch((err) => {
    logger.error('admin config fetch failed', err);
  });

const server = http.createServer(async (req, res) => {
  const url = req.url ?? '/';
  logger.debug(`req ${req.method} ${url}`);

  if (url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'alive', service: 'aetherspec-agent' }));
    return;
  }

  if (url === '/readyz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ready',
      checks: {
        agent: 'ok',
        mastra: 'loaded',
        adminConfig: adminConfigReady ? 'loaded' : 'pending',
      },
    }));
    return;
  }

  if (url === '/config') {
    const cfg = getCachedAdminConfig();
    if (cfg) {
      const safeProviders = cfg.providers.map((p) => ({
        ...p,
        apiKey: p.apiKey ? '***' : '',
      }));
      const safe = {
        ...cfg,
        providers: safeProviders,
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(safe));
    } else {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'config not loaded yet' }));
    }
    return;
  }

  if (url === '/') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      name: 'aetherspec-agent',
      version: '0.0.0',
      status: 'foundation',
      adminConfigReady,
    }));
    return;
  }

  // FUTURE: /agents/:id/stream — SSE endpoint that the Go gateway proxies.
  // FUTURE: /agents/:id/prompt — non-streaming prompt.
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(config.agent.port, () => {
  logger.info(`agent sidecar listening on :${config.agent.port}`, { env: config.agent.env });
});
