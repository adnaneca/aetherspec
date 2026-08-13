import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';
import { buildMastra } from './mastra.js';
import { fetchAdminConfig, getCachedAdminConfig } from './admin-config.js';
import { runAgentStream, type ChatMessage, AGENT_INSTRUCTIONS, buildGenerationPrompt, selfValidate, stripValidationArtifacts } from './agent-runner.js';
import { getAgentsForWorkflow, type BRSAgentId } from './agents.js';
import { BRSWorkflow, SRDWorkflow } from './workflow.js';
import { createSSECallbacks } from './sse-emitter.js';
import { getWorkflow } from './workflow-store.js';
import { buildNegotiatorChatPrompt, parseNegotiatorChatResponse } from './negotiator-chat.js';

buildMastra(); // Initialize Mastra (foundation stub)

const activeWorkflows = new Map<string, BRSWorkflow | SRDWorkflow>();

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';

// Fetch admin config on startup, then register workflow agents
let adminConfigReady = false;
fetchAdminConfig(GATEWAY_URL)
  .then(() => {
    adminConfigReady = true;
    const brsAgents = getAgentsForWorkflow('brs-orchestrator');
    const srdAgents = getAgentsForWorkflow('srd-orchestrator');
    logger.info('admin config loaded — workflow agents registered', {
      brsCount: Object.keys(brsAgents).length,
      srdCount: Object.keys(srdAgents).length,
    });
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
    const brsAgents = getAgentsForWorkflow('brs-orchestrator');
    const srdAgents = getAgentsForWorkflow('srd-orchestrator');
    const allAgents = { ...brsAgents, ...srdAgents };
    const entries = Object.entries(allAgents).map(([id, agent]) => ({
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
      version: '0.3.0',
      status: 'foundation',
      adminConfigReady,
    }));
    return;
  }

  // ── Workflow state endpoint ──
  // GET /workflow/:id
  const workflowStateMatch = url.match(/^\/workflow\/([^\/]+)$/);
  if (workflowStateMatch && method === 'GET') {
    const workflowId = workflowStateMatch[1];
    try {
      const row = await getWorkflow(workflowId);
      if (!row) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'workflow not found' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: row.id,
        projectId: row.projectId,
        docId: row.docId,
        stepId: row.stepId,
        agentId: row.agentId,
        status: row.status,
        state: row.state,
      }));
    } catch (err) {
      logger.error('failed to fetch workflow state', { workflowId, error: (err as Error).message });
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'failed to fetch workflow state' }));
    }
    return;
  }

  // ── Workflow start endpoint ──
  // POST /agents/:agentId/workflow/start
  const startMatch = url.match(/^\/agents\/([^\/]+)\/workflow\/start$/);
  if (startMatch && method === 'POST') {
    const orchestratorId = startMatch[1];

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

    const workflowId = randomUUID();

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
      'access-control-allow-origin': '*',
    });

    // Emit workflow ID as the first event so the client can resume.
    res.write(`data: ${JSON.stringify({ type: 'workflow', workflowId, status: 'started' })}\n\n`);

    const agents = getAgentsForWorkflow(orchestratorId);
    const expectedIds = orchestratorId.startsWith('srd-')
      ? ['srd-orchestrator', 'srd-writer', 'srd-negotiator', 'srd-validator']
      : ['brs-orchestrator', 'brs-writer', 'brs-negotiator', 'brs-validator'];
    const missing = expectedIds.filter((id) => !agents[id]);
    if (missing.length > 0) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: `Workflow agents not available: ${missing.join(', ')}. Check admin config.` })}\n\n`);
      res.end();
      return;
    }

    const callbacks = createSSECallbacks(res);
    const context = {
      workflowId,
      projectId: parsed.projectId || 'unknown',
      docId: parsed.docId || 'unknown',
      stepId: Number(parsed.stepId) || 0,
      sectionName: parsed.sectionName || '',
      sectionGuide: parsed.sectionGuide || '',
      dependencySections: parsed.dependencySections || [],
      upstreamSections: parsed.upstreamSections || [],
      inputDocuments: parsed.inputDocuments || [],
      qualityChecks: parsed.qualityChecks || [],
      project: parsed.project,
    };

    let workflow: BRSWorkflow | SRDWorkflow;
    if (orchestratorId.startsWith('srd-')) {
      workflow = new SRDWorkflow(
        {
          orchestrator: agents['srd-orchestrator']!,
          writer: agents['srd-writer']!,
          negotiator: agents['srd-negotiator']!,
          validator: agents['srd-validator']!,
        },
        context,
        callbacks,
      );
    } else {
      workflow = new BRSWorkflow(
        {
          orchestrator: agents['brs-orchestrator']!,
          writer: agents['brs-writer']!,
          negotiator: agents['brs-negotiator']!,
          validator: agents['brs-validator']!,
        },
        context,
        callbacks,
      );
    }

    activeWorkflows.set(workflowId, workflow);
    await workflow.run();
    return;
  }

  // ── Workflow resume endpoint ──
  // POST /agents/:agentId/workflow/:workflowId/resume
  const resumeMatch = url.match(/^\/agents\/([^\/]+)\/workflow\/([^\/]+)\/resume$/);
  if (resumeMatch && method === 'POST') {
    const workflowId = resumeMatch[2];

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

    const workflow = activeWorkflows.get(workflowId);
    if (!workflow) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Workflow not found' })}\n\n`);
      res.end();
      return;
    }

    const callbacks = createSSECallbacks(res);
    workflow.setCallbacks(callbacks);
    // Ensure userResponse is always passed as an object property as expected by the workflow.
    const userResponse = parsed.userResponse !== undefined ? parsed.userResponse : parsed;
    await workflow.resume(userResponse);
    return;
  }

  // ── Negotiator chat side-channel (WP-08) ──
  // POST /agents/:agentId/workflow/:workflowId/negotiator-chat
  const negotiatorChatMatch = url.match(/^\/agents\/([^\/]+)\/workflow\/([^\/]+)\/negotiator-chat$/);
  if (negotiatorChatMatch && method === 'POST') {
    const workflowId = negotiatorChatMatch[2];

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

    const workflow = activeWorkflows.get(workflowId);
    const context = workflow?.getContext();
    const inputDocuments = context?.inputDocuments ?? [];
    const project = context?.project ?? {};

    const workflowAgentId = workflow instanceof SRDWorkflow ? 'srd-negotiator' : 'brs-negotiator';
    const agents = getAgentsForWorkflow(workflowAgentId);
    const negotiator = agents[workflowAgentId];
    if (!negotiator) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Negotiator agent not available' })}\n\n`);
      res.end();
      return;
    }

    const prompt = buildNegotiatorChatPrompt({
      questionId: parsed.questionId,
      question: parsed.question,
      currentSuggestion: parsed.currentSuggestion,
      humanMessage: parsed.humanMessage,
      chatHistory: parsed.chatHistory || [],
      inputDocuments,
      project,
    });

    let fullResponse = '';
    try {
      await runAgentStream(
        { agentId: workflowAgentId, message: prompt, history: [] },
        {
          onToken: (delta) => {
            fullResponse += delta;
          },
          onDone: () => {
            const parsedResponse = parseNegotiatorChatResponse(fullResponse);
            res.write(`data: ${JSON.stringify({
              type: 'negotiator_chat_response',
              questionId: parsed.questionId,
              response: parsedResponse.response,
              updatedSuggestion: parsedResponse.updatedSuggestion,
              shouldUpdateSuggestion: parsedResponse.shouldUpdateSuggestion,
            })}\n\n`);
            res.end();
          },
          onError: (error) => {
            res.write(`data: ${JSON.stringify({ type: 'error', error })}\n\n`);
            res.end();
          },
        },
      );
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: (err as Error).message })}\n\n`);
      res.end();
    }
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
