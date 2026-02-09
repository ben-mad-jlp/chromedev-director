# Blueprint: Item 5 - HTTP API Server

## 1. Structure Summary

### Files

- `src/api-server.ts` — Hono-based HTTP server with REST endpoints, WebSocket, static serving
- `src/cli.ts` — CLI entry point for `npx chromedev-director gui`
- `package.json` — Add dependencies: `hono`, `@hono/node-server`, `@hono/node-ws`

### Type Definitions

```typescript
// Server options
type GuiOptions = {
  port: number;      // HTTP port (default 3838)
  cdpPort: number;   // Chrome DevTools port (default 9222)
  projectRoot: string; // Project root for storage (default cwd)
};

// WebSocket message types (server → client)
type WsMessage =
  | { type: 'run:start'; testId: string; runId: string }
  | { type: 'run:step'; testId: string; runId: string; stepIndex: number; stepLabel: string; nested: string | null; status: 'running' | 'passed' | 'failed'; duration_ms?: number; error?: string }
  | { type: 'run:complete'; testId: string; runId: string; status: 'passed' | 'failed' };
```

### Component Interactions

- REST endpoints call `storage.*` functions (mirrors MCP tools)
- `POST /api/tests/:id/run` calls `runTest()` with `onEvent` callback
- `onEvent` maps `RunEvent` types to `WsMessage` and broadcasts to WebSocket clients
- In-memory `activeRun` mutex prevents concurrent runs
- Static file serving from `gui/dist/` with SPA fallback
- `/api/chrome/status` probes Chrome's `/json/version` endpoint

---

## 2. Function Blueprints

### `function createApiServer(options: GuiOptions): Hono`

**Signature:**
```typescript
export function createApiServer(options: GuiOptions): Hono
```

**Pseudocode:**
1. Create Hono app instance
2. Set up WebSocket upgrade handler via `@hono/node-ws`
3. Register REST routes (see below)
4. Register WebSocket route at `/ws`
5. Register static file serving from `gui/dist/` with SPA fallback
6. Return app

**Stub:**
```typescript
export function createApiServer(options: GuiOptions): Hono {
  // TODO: Step 1 - Create Hono app
  // TODO: Step 2 - Set up WebSocket
  // TODO: Step 3 - Register REST routes
  // TODO: Step 4 - Register /ws route
  // TODO: Step 5 - Register static serving
  // TODO: Step 6 - Return app
  throw new Error('Not implemented');
}
```

---

### REST Endpoints

Each endpoint is a thin wrapper over storage functions:

**`GET /api/tests`**
```typescript
app.get('/api/tests', async (c) => {
  const tests = await storage.listTests(projectRoot);
  return c.json({ tests });
});
```

**`POST /api/tests`** — body: `{ name, test }`
```typescript
app.post('/api/tests', async (c) => {
  const { name, test } = await c.req.json();
  const saved = await storage.saveTest(projectRoot, name, test);
  return c.json({ id: saved.id, test: saved.test }, 201);
});
```

**`GET /api/tests/:id`**
**`PUT /api/tests/:id`**
**`DELETE /api/tests/:id`**
**`GET /api/tests/:id/results`**
**`GET /api/results/:runId`** — note: needs testId lookup or flat result storage

All follow the same pattern: validate input, call storage, return JSON or error.

**Error handling middleware:**
```typescript
app.onError((err, c) => {
  if (err.code === 'NOT_FOUND') return c.json({ error: err.message }, 404);
  if (err.code === 'SLUG_COLLISION') return c.json({ error: err.message }, 409);
  return c.json({ error: err.message }, 500);
});
```

---

### `POST /api/tests/:id/run` — Run with live progress

**Pseudocode:**
1. Check `activeRun` — if set, return `409 { error: "Test already running", activeRun }`
2. Load test via `storage.getTest(projectRoot, id)`
3. Generate `runId`
4. Set `activeRun = { testId: id, runId }`
5. Broadcast `run:start` to WebSocket clients
6. Create `onEvent` callback that maps `RunEvent` → `WsMessage` and broadcasts
7. Call `runTest(test.test, cdpPort, onEvent)` 
8. In `finally`: set `activeRun = null`, broadcast `run:complete`
9. Save result via `storage.saveResult()`
10. Return `{ runId, result }`

**Stub:**
```typescript
app.post('/api/tests/:id/run', async (c) => {
  // TODO: Step 1 - Check activeRun mutex
  // TODO: Step 2 - Load test
  // TODO: Step 3 - Generate runId, set activeRun
  // TODO: Step 4 - Broadcast run:start
  // TODO: Step 5 - Create onEvent callback
  // TODO: Step 6 - Run test
  // TODO: Step 7 - Save result, clear activeRun, broadcast run:complete
  // TODO: Step 8 - Return result
  throw new Error('Not implemented');
});
```

---

### WebSocket Handler

**Pseudocode:**
1. Maintain `Set<WSContext>` of connected clients
2. On connect: add to set
3. On close/error: remove from set
4. `broadcast(msg)` iterates set and sends JSON to each client
5. No client → server messages needed

**Stub:**
```typescript
const clients = new Set<WSContext>();

app.get('/ws', upgradeWebSocket((c) => ({
  onOpen(evt, ws) { clients.add(ws); },
  onClose(evt, ws) { clients.delete(ws); },
  onError(evt, ws) { clients.delete(ws); },
})));

function broadcast(msg: WsMessage) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    try { ws.send(data); } catch { clients.delete(ws); }
  }
}
```

---

### `GET /api/chrome/status` — Chrome Health Check

**Pseudocode:**
1. Fetch `http://localhost:{cdpPort}/json/version` with 2s timeout
2. If success: return `{ connected: true, version: data.Browser }`
3. If fail: return `{ connected: false }`

---

### `async function startGui(options: Partial<GuiOptions>): Promise<void>`

**Pseudocode:**
1. Merge defaults: port 3838, cdpPort 9222, projectRoot cwd
2. Call `storage.initStorage(projectRoot)`
3. Create app via `createApiServer(options)`
4. Start HTTP server via `@hono/node-server`
5. Log URL to stderr

---

### CLI Entry Point (`src/cli.ts`)

**Pseudocode:**
1. Parse `process.argv` for `gui` subcommand
2. Parse `--port` and `--cdp-port` flags
3. Call `startGui({ port, cdpPort })`

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: api-server-setup
    files: [src/api-server.ts, package.json]
    tests: []
    description: Create Hono app skeleton with WebSocket support, error middleware, static serving, install dependencies
    parallel: true
    depends-on: []

  - id: api-crud-routes
    files: [src/api-server.ts]
    tests: [src/api-server.test.ts]
    description: Implement REST endpoints for test CRUD and result queries
    parallel: false
    depends-on: [api-server-setup]

  - id: api-run-route
    files: [src/api-server.ts]
    tests: [src/api-server.test.ts]
    description: Implement POST /api/tests/:id/run with activeRun mutex, WebSocket broadcast, onEvent integration
    parallel: false
    depends-on: [api-crud-routes]

  - id: api-chrome-status
    files: [src/api-server.ts]
    tests: [src/api-server.test.ts]
    description: Implement GET /api/chrome/status endpoint
    parallel: true
    depends-on: [api-server-setup]

  - id: api-cli
    files: [src/cli.ts, package.json]
    tests: []
    description: Create CLI entry point for 'npx chromedev-director gui', add bin field to package.json
    parallel: false
    depends-on: [api-server-setup]

  - id: api-tests
    files: [src/api-server.test.ts]
    tests: [src/api-server.test.ts]
    description: Integration tests for REST endpoints, WebSocket broadcast, run mutex, Chrome status
    parallel: false
    depends-on: [api-crud-routes, api-run-route, api-chrome-status, api-cli]
```

### Execution Waves

**Wave 1 (no dependencies):**
- api-server-setup

**Wave 2 (depends on Wave 1):**
- api-crud-routes
- api-chrome-status
- api-cli

**Wave 3 (depends on Wave 2):**
- api-run-route

**Wave 4 (depends on Wave 3):**
- api-tests

### Summary
- **Total tasks:** 6
- **Total waves:** 4
- **Max parallelism:** 3 (Wave 2)
- **Cross-item dependency:** Requires Item 1 (storage), Item 2 (run_test), Item 3 (onEvent callback)