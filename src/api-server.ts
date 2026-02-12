/**
 * HTTP API Server for chromedev-director GUI
 * Provides REST endpoints for test CRUD, execution, and results
 * Includes WebSocket support for live test progress streaming
 */

import { Hono } from 'hono';
import { createNodeWebSocket } from '@hono/node-ws';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { OnEvent, TestDef, TestResult, RunEvent, SavedTest, TestRun, InputDef, SuiteResult } from './types.js';
import * as storage from './storage.js';
import { runTest } from './step-runner.js';
import { runSuite, OnSuiteEvent, SuiteEvent } from './suite-runner.js';
import { SessionManager } from './session-manager.js';
import { CDPClient } from './cdp-client.js';
import { generateTestFlowDiagram } from './diagram-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Server configuration options
 */
export type GuiOptions = {
  port: number;           // HTTP port (default 3000)
  cdpPort: number;        // Chrome DevTools port (default 9222)
  projectRoot: string;    // Project root for storage (default cwd)
  storageDir?: string;    // Storage directory (default {projectRoot}/.chromedev-director)
};

/**
 * WebSocket message types sent to clients
 */
export type WsMessage =
  | { type: 'run:start'; testId: string; runId: string }
  | {
      type: 'run:step';
      testId: string;
      runId: string;
      stepIndex: number;
      stepLabel: string;
      nested: string | null;
      status: 'running' | 'passed' | 'failed';
      duration_ms?: number;
      error?: string;
    }
  | { type: 'run:complete'; testId: string; runId: string; status: 'passed' | 'failed' }
  | { type: 'suite:start'; total: number }
  | { type: 'suite:test_start'; testId: string; testName: string; index: number }
  | { type: 'suite:test_complete'; testId: string; testName: string; index: number; status: 'passed' | 'failed' | 'skipped'; duration_ms: number; error?: string }
  | { type: 'suite:complete'; result: SuiteResult };

/**
 * Active test run tracking — prevents concurrent runs
 */
type ActiveRun = {
  testId: string;
  runId: string;
};

/**
 * WebSocket context type for Node.js
 */
type WSContext = {
  send: (data: string) => void;
  close: () => void;
};

/**
 * Create and configure the Hono API server
 */
export function createApiServer(options: GuiOptions): { app: Hono; injectWebSocket: (server: any) => void } {
  const app = new Hono();

  // Mutable config — updated by PUT /api/project
  const config = {
    projectRoot: options.projectRoot,
    storageDir: options.storageDir ?? `${options.projectRoot}/.chromedev-director`,
  };

  // Track active run
  let activeRun: ActiveRun | null = null;

  // WebSocket client tracking
  const clients = new Set<any>();

  // Initialize SessionManager singleton
  let sessionManager: SessionManager | null = null;
  function getSessionManager(): SessionManager {
    if (!sessionManager) {
      sessionManager = new SessionManager(config.storageDir);
    }
    return sessionManager;
  }

  /**
   * Broadcast a message to all connected WebSocket clients
   */
  function broadcast(msg: WsMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of Array.from(clients)) {
      try {
        ws.send(data);
      } catch {
        clients.delete(ws);
      }
    }
  }

  /**
   * Error handling middleware
   */
  app.onError((err: any, c: any) => {
    const errorCode = err.code || 'INTERNAL_ERROR';
    const statusCode =
      errorCode === 'NOT_FOUND' ? 404 : errorCode === 'SLUG_COLLISION' ? 409 : 500;

    return c.json({ error: err.message || 'Internal server error' }, statusCode);
  });

  /**
   * Set up WebSocket support
   */
  const nodeWs = createNodeWebSocket({ app });

  /**
   * WebSocket route for live test progress
   * Manages client connections for test execution events
   */
  app.get('/ws', nodeWs.upgradeWebSocket((c: any) => ({
    onOpen(evt: any, ws: any) {
      clients.add(ws);
    },
    onClose(evt: any, ws: any) {
      clients.delete(ws);
    },
    onError(evt: any, ws: any) {
      clients.delete(ws);
    },
  })));

  /**
   * Health check endpoint
   */
  app.get('/api/health', (c: any) => {
    return c.json({ status: 'ok', projectRoot: config.projectRoot });
  });

  /**
   * PUT /api/project — Switch to a different project root
   * Body: { projectRoot: string }
   * Rejects if a test is currently running or the path is invalid
   */
  app.put('/api/project', async (c: any) => {
    const body = await c.req.json() as any;
    const { projectRoot } = body;

    if (!projectRoot || typeof projectRoot !== 'string') {
      return c.json({ error: 'Missing or invalid "projectRoot" field' }, 400);
    }

    // Reject if a test is currently running
    if (activeRun) {
      return c.json({ error: 'Cannot switch project while a test is running' }, 409);
    }

    // Validate path exists and is a directory
    try {
      const stat = await fs.promises.stat(projectRoot);
      if (!stat.isDirectory()) {
        return c.json({ error: `Path is not a directory: ${projectRoot}` }, 400);
      }
    } catch {
      return c.json({ error: `Path does not exist: ${projectRoot}` }, 400);
    }

    // Compute new storage dir and initialize storage
    const newStorageDir = `${projectRoot}/.chromedev-director`;
    await storage.initStorage({
      storageDir: newStorageDir,
      resultRetentionDays: 30,
      port: options.port,
    });

    // Update mutable config
    config.projectRoot = projectRoot;
    config.storageDir = newStorageDir;

    return c.json({ projectRoot });
  });

  /**
   * GET /api/tests — List all tests
   */
  app.get('/api/tests', async (c: any) => {
    try {
      const tests = await storage.listTests(config.storageDir);
      return c.json({ tests });
    } catch (error) {
      throw error;
    }
  });

  /**
   * POST /api/tests — Create a new test
   * Body: { name: string, test: TestDef, description?: string, tags?: string[] }
   */
  app.post('/api/tests', async (c: any) => {
    try {
      const body = await c.req.json() as any;
      const { name, test, description, tags } = body;

      if (!name || typeof name !== 'string') {
        return c.json({ error: 'Missing or invalid "name" field' }, 400);
      }
      if (!test) {
        return c.json({ error: 'Missing or invalid "test" field' }, 400);
      }

      // Generate ID from name using slugify
      const id = storage.slugify(name);

      try {
        const savedTest = await storage.saveTest(config.storageDir, id, name, test, {
          description,
          tags,
        });
        return c.json({ id: savedTest.id, test: savedTest }, 201);
      } catch (error: any) {
        if (error.message && error.message.includes('Test ID already exists')) {
          return c.json({ error: error.message }, 409);
        }
        throw error;
      }
    } catch (error: any) {
      throw error;
    }
  });

  /**
   * GET /api/tests/:testId/flow-diagram — Get Mermaid diagram
   * IMPORTANT: Must come before /api/tests/:id to avoid route conflict
   */
  app.get('/api/tests/:testId/flow-diagram', async (c: any) => {
    try {
      const testId = c.req.param('testId');
      const test = await storage.getTest(config.storageDir, testId);

      if (!test) {
        return c.json({ error: 'Test not found' }, 404);
      }

      const diagram = generateTestFlowDiagram(test);
      return c.json({ diagram });
    } catch (error: any) {
      console.error('Failed to generate flow diagram:', error);
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * GET /api/tests/:id — Get a specific test
   */
  app.get('/api/tests/:id', async (c: any) => {
    try {
      const id = c.req.param('id');
      const test = await storage.getTest(config.storageDir, id);

      if (!test) {
        return c.json({ error: `Test not found: ${id}` }, 404);
      }

      return c.json({ test });
    } catch (error) {
      throw error;
    }
  });

  /**
   * PUT /api/tests/:id — Update a test
   * Body: { name?: string, definition?: TestDef, description?: string, tags?: string[] }
   */
  app.put('/api/tests/:id', async (c: any) => {
    try {
      const id = c.req.param('id');
      const body = await c.req.json() as any;

      // Check if test exists first
      const existing = await storage.getTest(config.storageDir, id);
      if (!existing) {
        return c.json({ error: `Test not found: ${id}` }, 404);
      }

      const updatedTest = await storage.updateTest(config.storageDir, id, body);
      return c.json({ test: updatedTest });
    } catch (error: any) {
      if (error.message && error.message.includes('Test not found')) {
        throw { code: 'NOT_FOUND', message: error.message };
      }
      throw error;
    }
  });

  /**
   * DELETE /api/tests/:id — Delete a test and all its results
   */
  app.delete('/api/tests/:id', async (c: any) => {
    try {
      const id = c.req.param('id');
      await storage.deleteTest(config.storageDir, id);
      return c.json({ success: true });
    } catch (error) {
      throw error;
    }
  });

  /**
   * GET /api/tests/:testId/results — List all results for a test
   * Query params: ?status=passed|failed&limit=10
   */
  app.get('/api/tests/:testId/results', async (c: any) => {
    try {
      const testId = c.req.param('testId');
      const status = c.req.query('status') as 'passed' | 'failed' | undefined;
      const limit = c.req.query('limit') ? parseInt(c.req.query('limit'), 10) : undefined;

      const runs = await storage.listRuns(config.storageDir, testId, { status, limit });
      return c.json({ runs });
    } catch (error) {
      throw error;
    }
  });

  /**
   * GET /api/tests/:testId/results/:runId — Get a specific test result
   */
  app.get('/api/tests/:testId/results/:runId', async (c: any) => {
    try {
      const testId = c.req.param('testId');
      const runId = c.req.param('runId');
      const sections = c.req.query('sections'); // Add query param for selective data

      const run = await storage.getRun(config.storageDir, testId, runId);
      if (!run) {
        return c.json({ error: `Result not found: ${runId}` }, 404);
      }

      // Filter response based on requested sections (inverse filtering — only include what's requested)
      if (sections) {
        const requestedSections = (sections as string).split(',');
        const filteredRun = { ...run };
        const r = filteredRun.result as any;

        const largeFields = ['console_log', 'network_log', 'dom_snapshot', 'screenshot', 'dom_snapshots', 'step_definition', 'step_traces'];
        for (const field of largeFields) {
          if (!requestedSections.includes(field) && r[field] != null) {
            delete r[field];
          }
        }

        return c.json({ run: filteredRun });
      }

      return c.json({ run });
    } catch (error) {
      throw error;
    }
  });

  /**
   * POST /api/sessions — Register new session
   */
  app.post('/api/sessions', async (c: any) => {
    try {
      const body = await c.req.json() as any;
      const { sessionId } = body;

      if (!sessionId || typeof sessionId !== 'string') {
        return c.json({ error: 'sessionId must be a non-empty string' }, 400);
      }

      const manager = getSessionManager();
      await manager.load();

      // Check if already registered
      const existing = manager.getTargetId(sessionId);
      if (existing) {
        const sessions = manager.listSessions();
        const session = sessions.find(s => s.sessionId === sessionId);
        return c.json({ session, status: 'existing' });
      }

      // Register via CDP
      const port = options.cdpPort;
      const client = new CDPClient(port, undefined, {
        sessionId,
        sessionManager: manager
      });

      await client.connect('about:blank');
      const targetId = manager.getTargetId(sessionId);
      await client.close();

      const sessions = manager.listSessions();
      const session = sessions.find(s => s.sessionId === sessionId);

      return c.json({ session, status: 'created' });
    } catch (error: any) {
      console.error('Failed to register session:', error);
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * GET /api/sessions — List all sessions
   */
  app.get('/api/sessions', async (c: any) => {
    try {
      const manager = getSessionManager();
      await manager.load();
      const sessions = manager.listSessions();
      return c.json({ sessions });
    } catch (error: any) {
      console.error('Failed to list sessions:', error);
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * DELETE /api/sessions/:sessionId — Delete session
   */
  app.delete('/api/sessions/:sessionId', async (c: any) => {
    try {
      const sessionId = c.req.param('sessionId');
      const manager = getSessionManager();
      await manager.load();
      await manager.unregisterSession(sessionId);
      return c.json({ success: true });
    } catch (error: any) {
      console.error('Failed to delete session:', error);
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * POST /api/tests/:id/run — Execute a test and stream live progress
   *
   * Acquires activeRun mutex to prevent concurrent execution.
   * Calls runTest() with onEvent callback that broadcasts progress to WebSocket clients.
   * Returns immediately with { runId, result } after test completes.
   *
   * Error handling:
   * - 400 if test not found
   * - 409 if another test is already running
   * - 500 for execution errors
   *
   * WebSocket events emitted:
   * - run:start at beginning
   * - run:step for each step (with status: running/passed/failed)
   * - run:complete at end with final status
   */
  app.post('/api/tests/:id/run', async (c: any) => {
    try {
      const testId = c.req.param('id');
      const body = await c.req.json() as any;
      const cdpPortOverride = body.port ?? options.cdpPort;
      const sessionId = body.sessionId; // Add sessionId extraction

      // Step 1: Check activeRun mutex — prevent concurrent execution
      if (activeRun) {
        return c.json(
          {
            error: 'Test already running',
            activeRun,
          },
          409
        );
      }

      // Step 2: Load test from storage
      const test = await storage.getTest(config.storageDir, testId);
      if (!test) {
        return c.json({ error: `Test not found: ${testId}` }, 400);
      }

      // Step 2.5: Validate and merge runtime inputs
      let mergedInputs: Record<string, unknown> | undefined;
      const inputDefs = test.definition.inputs;
      if (inputDefs && inputDefs.length > 0) {
        const provided: Record<string, unknown> = body.inputs ?? {};
        mergedInputs = {};
        const missing: string[] = [];

        for (const def of inputDefs) {
          if (def.name in provided) {
            mergedInputs[def.name] = provided[def.name];
          } else if (def.default !== undefined) {
            mergedInputs[def.name] = def.default;
          } else if (def.required !== false) {
            missing.push(def.name);
          }
        }

        if (missing.length > 0) {
          return c.json({ error: `Missing required inputs: ${missing.join(', ')}` }, 400);
        }
      } else if (body.inputs) {
        // No inputDefs but caller sent inputs — pass them through
        mergedInputs = body.inputs;
      }

      // Initialize session manager if sessionId provided
      let sessionManagerInstance: SessionManager | undefined;
      if (sessionId) {
        sessionManagerInstance = getSessionManager();
        await sessionManagerInstance.load();
      }

      // Step 3: Generate runId and set activeRun
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-');
      const runId = `${timestamp}-${Math.random().toString(36).substring(7)}`;

      activeRun = { testId, runId };

      try {
        // Step 4: Broadcast run:start event
        broadcast({
          type: 'run:start',
          testId,
          runId,
        });
        // Step 5: Create onEvent callback that maps RunEvent to WsMessage and broadcasts
        const onEventCallback: OnEvent = (event: RunEvent) => {
          if (event.type === 'step:start') {
            broadcast({
              type: 'run:step',
              testId,
              runId,
              stepIndex: event.stepIndex,
              stepLabel: event.label,
              nested: event.nested,
              status: 'running',
            });
          } else if (event.type === 'step:pass') {
            broadcast({
              type: 'run:step',
              testId,
              runId,
              stepIndex: event.stepIndex,
              stepLabel: event.label,
              nested: event.nested,
              status: 'passed',
              duration_ms: event.duration_ms,
            });
          } else if (event.type === 'step:fail') {
            broadcast({
              type: 'run:step',
              testId,
              runId,
              stepIndex: event.stepIndex,
              stepLabel: event.label,
              nested: event.nested,
              status: 'failed',
              duration_ms: event.duration_ms,
              error: event.error,
            });
          }
          // Console and network events are not broadcasted in the current design
        };

        // Step 6: Call runTest() with onEvent handler, merged inputs, and session
        const shouldCreateTab = false; // Don't create tabs in GUI
        const result = await runTest(
          test.definition,
          cdpPortOverride,
          onEventCallback,
          config.projectRoot,
          mergedInputs,
          shouldCreateTab,
          sessionId,
          sessionManagerInstance
        );

        // Step 7: Save result to storage
        const savedRun = await storage.saveRun(config.storageDir, testId, result);

        // Step 8: Broadcast run:complete event
        broadcast({
          type: 'run:complete',
          testId,
          runId,
          status: result.status,
        });

        return c.json({ runId, result: savedRun }, 200);
      } finally {
        // Always clear activeRun, even if execution fails
        activeRun = null;
      }
    } catch (error: any) {
      // Clear activeRun if not already cleared
      activeRun = null;
      throw error;
    }
  });

  /**
   * POST /api/suites/run — Execute a suite of tests
   * Body: { tag?: string, testIds?: string[], stopOnFailure?: boolean }
   * Must provide either tag or testIds
   */
  app.post('/api/suites/run', async (c: any) => {
    try {
      const body = await c.req.json() as any;
      const { tag, testIds, stopOnFailure, concurrency } = body;

      // Validate inputs
      if (!tag && (!testIds || !Array.isArray(testIds) || testIds.length === 0)) {
        return c.json({ error: 'Either "tag" or "testIds" must be provided' }, 400);
      }

      // Check activeRun mutex
      if (activeRun) {
        return c.json({ error: 'A test or suite is already running', activeRun }, 409);
      }

      // Set a synthetic activeRun to prevent concurrent runs
      activeRun = { testId: '__suite__', runId: `suite-${Date.now()}` };

      try {
        // Suite event handler — broadcasts to WebSocket clients
        const onSuiteEvent: OnSuiteEvent = (event: SuiteEvent) => {
          broadcast(event as WsMessage);
        };

        const result = await runSuite({
          tag,
          testIds,
          port: options.cdpPort,
          stopOnFailure: stopOnFailure ?? false,
          storageDir: config.storageDir,
          projectRoot: config.projectRoot,
          concurrency: Math.min(Math.max(concurrency ?? 3, 1), 10),
        }, onSuiteEvent);

        return c.json({ result }, 200);
      } finally {
        activeRun = null;
      }
    } catch (error: any) {
      activeRun = null;
      throw error;
    }
  });

  /**
   * GET /api/chrome/status — Chrome health check endpoint
   * Polls the Chrome DevTools Protocol endpoint to determine connection status
   * Returns { connected: boolean, version?: string, port: number }
   * Used by the GUI to display Chrome connection state in the UI
   */
  app.get('/api/chrome/status', async (c: any) => {
    const statusUrl = `http://localhost:${options.cdpPort}/json/version`;
    const timeoutMs = 2000;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(statusUrl, {
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          return c.json(
            {
              connected: false,
              port: options.cdpPort,
            },
            200
          );
        }

        const data = await response.json() as { Browser?: string };
        const version = data.Browser;

        return c.json(
          {
            connected: true,
            version,
            port: options.cdpPort,
          },
          200
        );
      } catch (err) {
        return c.json(
          {
            connected: false,
            port: options.cdpPort,
          },
          200
        );
      }
    } catch (err) {
      // Catch any unexpected errors
      return c.json(
        {
          connected: false,
          port: options.cdpPort,
        },
        200
      );
    }
  });

  // Static file serving for GUI (from gui/dist/)
  const guiDistPath = path.resolve(__dirname, '..', 'gui', 'dist');

  // Serve static assets (JS, CSS, images)
  app.use('/assets/*', serveStatic({ root: guiDistPath }));

  // Serve root-level static files (favicon, icon, etc.)
  app.get('/favicon.ico', serveStatic({ root: guiDistPath, path: '/favicon.ico' }));
  app.get('/icon.png', serveStatic({ root: guiDistPath, path: '/icon.png' }));

  // SPA fallback: serve index.html for all non-API routes
  app.get('*', async (c) => {
    const indexPath = path.join(guiDistPath, 'index.html');
    try {
      const html = fs.readFileSync(indexPath, 'utf-8');
      return c.html(html);
    } catch {
      return c.text('GUI not built. Run: cd gui && npm run build', 500);
    }
  });

  // Return the configured app and WebSocket injector
  return { app, injectWebSocket: nodeWs.injectWebSocket };
}

/**
 * Start the HTTP server with GUI
 */
export async function startGui(options: Partial<GuiOptions>): Promise<void> {
  const opts: GuiOptions = {
    port: options.port ?? 3000,
    cdpPort: options.cdpPort ?? 9222,
    projectRoot: options.projectRoot ?? process.cwd(),
  };

  // Initialize storage with the project root
  const storageDir = `${opts.projectRoot}/.chromedev-director`;
  await storage.initStorage({
    storageDir,
    resultRetentionDays: 30,
    port: opts.port,
  });

  const { app, injectWebSocket } = createApiServer(opts);

  console.error(`Starting chromedev-director GUI on http://localhost:${opts.port}`);
  console.error(`Chrome DevTools on localhost:${opts.cdpPort}`);

  const server = serve({
    fetch: app.fetch,
    port: opts.port,
  });

  injectWebSocket(server);
}
