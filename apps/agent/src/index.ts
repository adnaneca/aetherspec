import http from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';
import { buildMastra } from './mastra.js';
import { fetchAdminConfig, getCachedAdminConfig } from './admin-config.js';
import { runAgentStream, type ChatMessage, AGENT_INSTRUCTIONS, buildGenerationPrompt, selfValidate, stripValidationArtifacts } from './agent-runner.js';
import { getBRSAgents, type BRSAgentId } from './agents.js';

buildMastra(); // Initialize Mastra (foundation stub)

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';

// Fetch admin config on startup, then register BRS workflow agents
let adminConfigReady = false;
fetchAdminConfig(GATEWAY_URL)
  .then(() => {
    adminConfigReady = true;
    const brsAgents = getBRSAgents();
    const registeredIds = Object.keys(brsAgents);
    logger.info('admin config loaded — BRS agents registered', { registeredIds, count: registeredIds.length });
  })
  .catch((err) => {
    logger.error('admin config fetch failed', err);
  });

const server = http.createServer(async (req, res) => {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';
  logger.debug(`req ${method} ${url}`);

  // ── Health endpoints ──

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
      const safeAgents = cfg.agents
        ? Object.fromEntries(
            Object.entries(cfg.agents).map(([id, a]) => [id, { ...a, apiKey: a.apiKey ? '***' : '' }])
          )
        : undefined;
      const safe = {
        ...cfg,
        providers: safeProviders,
        agents: safeAgents,
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(safe));
    } else {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'config not loaded yet' }));
    }
    return;
  }

  if (url === '/agents' && method === 'GET') {
    const brsAgents = getBRSAgents();
    const entries = Object.entries(brsAgents).map(([id, agent]) => ({
      id,
      name: agent.name,
    }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ agents: entries }));
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

  // ── Agent stream endpoint ──
  // POST /agents/:agentId/stream
  // Body: { "message": "...", "history": [{ "role": "user", "content": "..." }] }
  // Response: SSE stream (text/event-stream)

  const streamMatch = url.match(/^\/agents\/([^\/]+)\/stream$/);
  if (streamMatch && method === 'POST') {
    const agentId = streamMatch[1] as BRSAgentId | (string & {});

    // Read request body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let parsed: { message?: string; history?: ChatMessage[] };
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid JSON body' }));
      return;
    }

    if (!parsed.message) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'message is required' }));
      return;
    }

    // Set SSE headers
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
      'access-control-allow-origin': '*',
    });

    // Run the agent stream
    await runAgentStream(
      { message: parsed.message, agentId, history: parsed.history },
      {
        onToken: (delta) => {
          res.write(`data: ${JSON.stringify({ type: 'token', delta })}\n\n`);
        },
        onDone: (tokensUsed) => {
          res.write(`data: ${JSON.stringify({ type: 'done', tokensUsed })}\n\n`);
          res.end();
        },
        onError: (error) => {
          res.write(`data: ${JSON.stringify({ type: 'error', error })}\n\n`);
          res.end();
        },
      },
    );
    return;
  }

  // ── Agent generate endpoint (BRS section generation) ──
  // POST /agents/:agentId/generate
  // Body: { sectionId, sectionName, sectionGuide, dependencies, inputDocs, qualityChecks, existingDraft, projectId, docId, minioPath }
  // Response: SSE stream (status → tokens → findings → done)

  const generateMatch = url.match(/^\/agents\/([^\/]+)\/generate$/);
  if (generateMatch && method === 'POST') {
    const agentId = generateMatch[1];

    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid JSON body' }));
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
      'access-control-allow-origin': '*',
    });

    res.write(`data: ${JSON.stringify({ type: 'status', step: 'generating', message: `Generating Section ${parsed.sectionId}: ${parsed.sectionName}...` })}\n\n`);

    const systemPrompt = AGENT_INSTRUCTIONS[agentId] || AGENT_INSTRUCTIONS['general'];
    const userPrompt = buildGenerationPrompt(parsed);

    let generatedContent = '';

    await runAgentStream(
      { message: userPrompt, agentId, history: [{ role: 'system', content: systemPrompt }] },
      {
        onToken: (delta) => {
          generatedContent += delta;
          res.write(`data: ${JSON.stringify({ type: 'token', delta })}\n\n`);
        },
        onDone: (tokensUsed) => {
          res.write(`data: ${JSON.stringify({ type: 'status', step: 'validating', message: 'Running quality checks...' })}\n\n`);

          const cleanContent = stripValidationArtifacts(generatedContent);
          const findings = selfValidate(parsed.sectionId, parsed.sectionName, cleanContent);
          res.write(`data: ${JSON.stringify({ type: 'findings', findings })}\n\n`);

          res.write(`data: ${JSON.stringify({ type: 'done', tokensUsed })}\n\n`);
          res.end();
        },
        onError: (error) => {
          res.write(`data: ${JSON.stringify({ type: 'error', error })}\\n\\n`);
          res.end();
        },
      },
    );
    return;
  }

  // ── 404 ──

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(config.agent.port, () => {
  logger.info(`agent sidecar listening on :${config.agent.port}`, { env: config.agent.env });
});
