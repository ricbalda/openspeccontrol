// The demo repo's file tree, shared by `scripts/demo-repo.mjs` (development)
// and `src/main/desktop/demo-repo.ts` (Ayuda → Crear repositorio de
// demostración, Fase 5.7), so the two can never drift apart. Plain .mjs on
// purpose: the dev script has no TypeScript runner, and the desktop module
// picks the definitions up through the .d.mts beside this file.

/** The repo folder name inside the folder the user picks. */
export const DEMO_REPO_NAME = 'hello-app'
/** The active change the demo opens on ("In review" right away). */
export const DEMO_CHANGE = 'add-hello-endpoint'

/**
 * Every file of <folder>/hello-app, keyed by its path relative to the repo.
 * `today` lands in the change's .openspec.yaml (created: …).
 */
export const demoFiles = (today) => ({
  // ---- a small, zero-dependency Node app, so "Build it" can really finish ----
  'package.json': `${JSON.stringify(
    {
      name: 'hello-app',
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: { start: 'node src/server.js', test: 'node --test' },
      engines: { node: '>=20' }
    },
    null,
    2
  )}\n`,
  '.gitignore': 'node_modules/\n',
  'README.md': `# hello-app

Demo repository for OpenSpecControl: a tiny HTTP API with no dependencies.

\`\`\`bash
npm start   # http://localhost:3000/api/health
npm test    # node:test
\`\`\`
`,
  'src/app.js': `import http from 'node:http';
import { health } from './routes/health.js';

/** "METHOD /path" → handler(req) returning { status, body }. */
export const routes = {
  'GET /api/health': health,
};

export function createApp() {
  return http.createServer(async (req, res) => {
    const handler = routes[\`\${req.method} \${req.url}\`];
    const { status, body } = handler ? await handler(req) : { status: 404, body: { error: 'not found' } };
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
}
`,
  'src/routes/health.js': `export function health() {
  return { status: 200, body: { status: 'ok' } };
}
`,
  'src/server.js': `import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
createApp().listen(port, () => console.log(\`hello-app on http://localhost:\${port}\`));
`,
  'test/health.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('GET /api/health returns ok', async () => {
  const server = createApp().listen(0);
  const { port } = server.address();
  const res = await fetch(\`http://localhost:\${port}/api/health\`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
  server.close();
});

test('unknown routes return 404', async () => {
  const server = createApp().listen(0);
  const { port } = server.address();
  const res = await fetch(\`http://localhost:\${port}/nope\`);
  assert.equal(res.status, 404);
  server.close();
});
`,

  // ---- OpenSpec: one main spec and one change ready for review ----
  'openspec/config.yaml': 'schema: spec-driven\n',
  'openspec/specs/health/spec.md': `# health Specification

## Purpose
Let clients and load balancers check that the service is up.

## Requirements
### Requirement: Health check
The service SHALL answer \`GET /api/health\` with status 200 and \`{ "status": "ok" }\`.

#### Scenario: service is up
- **WHEN** a client calls \`GET /api/health\`
- **THEN** it receives status 200 and \`{ "status": "ok" }\`
`,
  'openspec/changes/add-hello-endpoint/.openspec.yaml': `schema: spec-driven\ncreated: ${today}\n`,
  'openspec/changes/add-hello-endpoint/proposal.md': `# Proposal: Add hello endpoint

## Why
Clients need a cheap greeting call that also proves routing works end to end.

## What Changes
- Add \`GET /api/v1/helloworld\` returning a JSON greeting.
- Log every call at debug level.

## Capabilities
### New Capabilities
- \`greeting\`: a hello endpoint for clients.

## Impact
- New file \`src/routes/hello.js\`, one new entry in the route table in \`src/app.js\`, a new test.
`,
  'openspec/changes/add-hello-endpoint/design.md': `# Design

## Context
The app is a zero-dependency Node HTTP server. \`src/app.js\` holds a route table that maps
\`"METHOD /path"\` to a handler returning \`{ status, body }\`; tests use \`node:test\` and \`fetch\`.

## Decisions
- One handler module per route, like \`src/routes/health.js\`.
- Return \`{ "message": "Hello" }\` with status 200.
- Log each call with \`console.debug\`, so normal runs stay quiet.
`,
  'openspec/changes/add-hello-endpoint/specs/greeting/spec.md': `## ADDED Requirements
### Requirement: Hello endpoint
The service SHALL expose \`GET /api/v1/helloworld\`, answering with status 200 and \`{ "message": "Hello" }\`.

#### Scenario: call the endpoint
- **WHEN** a client calls \`GET /api/v1/helloworld\`
- **THEN** it receives status 200 and \`{ "message": "Hello" }\`
`,
  'openspec/changes/add-hello-endpoint/tasks.md': `## 1. Implementation
- [ ] 1.1 Add the handler in \`src/routes/hello.js\` (returns the greeting, logs the call with \`console.debug\`)
- [ ] 1.2 Register \`GET /api/v1/helloworld\` in the route table in \`src/app.js\`
- [ ] 1.3 Add \`test/hello.test.js\` checking the status and body; \`npm test\` passes
`
})
