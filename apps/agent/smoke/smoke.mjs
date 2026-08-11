#!/usr/bin/env node
/**
 * Smoke test for the AetherSpec agent sidecar.
 *
 * Starts the agent sidecar in a child process, waits for /readyz, then:
 *   1. Calls GET /agents to verify the 4 BRS workflow agents are registered.
 *   2. Calls POST /agents/brs-orchestrator/stream with a simple message and expects tokens.
 *   3. Calls POST /agents/brs-writer/generate with a minimal section payload and expects tokens + findings + done.
 *
 * Usage: node smoke/smoke.mjs
 * Environment: GATEWAY_URL (optional), OLLAMA_API_KEY (optional), OLLAMA_BASE_URL (optional)
 */
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:3456';
const STARTUP_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 60_000;

async function httpGet(path) {
  const resp = await fetch(`${AGENT_URL}${path}`);
  if (!resp.ok) {
    throw new Error(`GET ${path} failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

async function httpPostStream(path, body, onEvent) {
  const resp = await fetch(`${AGENT_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`POST ${path} failed: ${resp.status} ${await resp.text()}`);
  }
  if (!resp.body) {
    throw new Error(`POST ${path} returned no body`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let tokens = '';
  let findings = null;
  let done = false;
  let error = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done: streamDone } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice('data: '.length);
        if (raw === '[DONE]') continue;
        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          continue;
        }
        onEvent?.(event);
        if (event.type === 'token') tokens += event.delta;
        if (event.type === 'findings') findings = event.findings;
        if (event.type === 'done') done = true;
        if (event.type === 'error') error = event.error;
      }
    }
    if (streamDone) break;
  }
  return { tokens, findings, done, error };
}

async function waitForReady() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${AGENT_URL}/readyz`);
      if (resp.ok) {
        const data = await resp.json();
        if (data?.checks?.adminConfig === 'loaded') {
          return data;
        }
      }
    } catch {
      // not ready yet
    }
    await setTimeout(500);
  }
  throw new Error('agent sidecar did not become ready in time');
}

async function run() {
  console.log('starting agent sidecar for smoke test...');
  const proc = spawn('node', ['dist/index.js'], {
    cwd: new URL('..', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GATEWAY_URL: process.env.GATEWAY_URL || 'http://localhost:3000' },
  });
  proc.stdout.on('data', (d) => process.stdout.write(d));
  proc.stderr.on('data', (d) => process.stderr.write(d));

  try {
    await waitForReady();
    console.log('agent sidecar ready');

    // 1. Verify agents are registered
    const agentsResp = await httpGet('/agents');
    const ids = agentsResp.agents.map((a) => a.id).sort();
    const expected = ['brs-negotiator', 'brs-orchestrator', 'brs-validator', 'brs-writer'];
    if (JSON.stringify(ids) !== JSON.stringify(expected)) {
      throw new Error(`expected agents ${expected.join(', ')}, got ${ids.join(', ')}`);
    }
    console.log('✓ BRS workflow agents registered:', ids.join(', '));

    // 2. Smoke chat with the orchestrator
    console.log('chatting with brs-orchestrator...');
    const chatResult = await httpPostStream('/agents/brs-orchestrator/stream', {
      message: 'What is the first step in drafting a BRS?',
      history: [],
    });
    if (!chatResult.done || chatResult.error) {
      throw new Error(`chat failed: ${chatResult.error || 'not done'}`);
    }
    if (!chatResult.tokens || chatResult.tokens.length < 10) {
      throw new Error('chat returned too few tokens');
    }
    console.log('✓ brs-orchestrator responded with', chatResult.tokens.length, 'chars');

    // 3. Smoke generate with the writer
    console.log('generating section with brs-writer...');
    const generateResult = await httpPostStream('/agents/brs-writer/generate', {
      sectionId: 1,
      sectionName: 'Executive Summary',
      sectionGuide: '1.1 Purpose\n1.2 Scope\n1.3 Definitions',
      dependencies: {},
      inputDocs: [],
      qualityChecks: [],
    });
    if (!generateResult.done || generateResult.error) {
      throw new Error(`generate failed: ${generateResult.error || 'not done'}`);
    }
    if (!generateResult.tokens || generateResult.tokens.length < 50) {
      throw new Error('generate returned too few tokens');
    }
    if (!generateResult.findings) {
      throw new Error('generate did not return findings');
    }
    console.log('✓ brs-writer generated', generateResult.tokens.length, 'chars with', generateResult.findings.length, 'findings');

    console.log('\nall smoke tests passed');
  } finally {
    proc.kill('SIGTERM');
    await setTimeout(1_000);
    if (!proc.killed) proc.kill('SIGKILL');
  }
}

run().catch((err) => {
  console.error('smoke test failed:', err);
  process.exit(1);
});
