# chromedev-director

MCP server and web GUI for autonomous browser testing via Chrome DevTools Protocol.

Define test steps (navigate, fill, click, assert, mock network, etc.) as JSON, run them against a live Chrome instance, and get structured pass/fail results with diagnostics.

## Features

- **MCP server** — exposes `run_test`, `save_test`, `list_tests`, `get_test`, `delete_test`, `list_results`, `get_result` tools for Claude integration
- **Web GUI** — test management dashboard with live step-by-step progress via WebSocket
- **Runtime inputs** — parameterize tests with `inputs` so values (usernames, passwords, IDs) are prompted before each run
- **Step types** — `eval`, `fill`, `click`, `assert`, `wait`, `wait_for`, `console_check`, `network_check`, `mock_network`, `run_test` (nested)
- **Variable chaining** — `eval` steps store results via `as` field, referenced as `$vars.KEY` in subsequent steps
- **Environment interpolation** — `$env.KEY` for static config, `$vars.KEY` for runtime values
- **Mock network** — intercept requests by glob pattern, return custom responses with automatic CORS preflight handling
- **Nested tests** — `run_test` step executes another saved test inline with cycle detection
- **Result persistence** — test runs are saved with timestamps, status, errors, console logs, and DOM snapshots

## Prerequisites

- Node.js >= 18
- Chrome/Chromium running with remote debugging enabled:

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug
```

## Setup

```bash
npm install
npm run build
```

## Usage

### MCP Server (for Claude)

```bash
npm start
# or
node dist/server.js
```

Add to your MCP client config:

```json
{
  "mcpServers": {
    "chromedev-director": {
      "command": "node",
      "args": ["dist/server.js"]
    }
  }
}
```

### Web GUI

```bash
npx chromedev-director gui
npx chromedev-director gui --port 8000 --chrome-port 9333
npx chromedev-director gui --project-root ./my-project
```

Build the GUI frontend first:

```bash
cd gui && npm install && npm run build
```

Then start the server — the GUI is served at `http://localhost:3000`.

## Test Definition (TestDef)

```jsonc
{
  "url": "http://localhost:8081",
  "env": { "BASE_URL": "http://localhost:3001" },
  "inputs": [
    { "name": "username", "label": "Username", "type": "text" },
    { "name": "password", "label": "Password", "type": "text", "default": "1234" },
    { "name": "retries", "label": "Max Retries", "type": "number", "default": 3 },
    { "name": "verbose", "label": "Verbose Logging", "type": "boolean", "default": false, "required": false }
  ],
  "before": [
    { "label": "Mock API", "mock_network": { "match": "*api/users*", "status": 200, "body": [] } }
  ],
  "steps": [
    { "label": "Fill username", "fill": { "selector": "[aria-label='Username']", "value": "$vars.username" } },
    { "label": "Fill password", "fill": { "selector": "[aria-label='Password']", "value": "$vars.password" } },
    { "label": "Click login", "click": { "selector": "button[type='submit']" } },
    { "label": "Wait for dashboard", "wait_for": { "selector": ".dashboard", "timeout": 10000 } },
    { "label": "Verify title", "assert": "document.title.includes('Dashboard')" }
  ],
  "after": [
    { "label": "Check console", "console_check": ["error"] }
  ],
  "timeout": 30000
}
```

## Runtime Inputs

The `inputs` array on a TestDef declares parameters that are collected before each run and seeded as `$vars.name`:

```ts
interface InputDef {
  name: string;                          // becomes $vars.name
  label: string;                         // display label in form
  type: 'text' | 'number' | 'boolean';  // form control type
  default?: string | number | boolean;   // pre-filled value
  required?: boolean;                    // default true
}
```

**GUI**: clicking Run opens a dialog pre-filled with defaults. Fill in values and submit.

**MCP**: pass `inputs` alongside `testId` or `test`:

```json
{ "testId": "login-flow", "inputs": { "username": "admin", "password": "secret" } }
```

Tests without `inputs` work exactly as before — no dialog, no change in behavior.

## Step Types

| Step | Description | Example |
|------|-------------|---------|
| `eval` | Execute JS in page. `as` stores result in `$vars`. | `{ "eval": "document.title", "as": "title" }` |
| `fill` | Fill an input field (dispatches input/change events). | `{ "fill": { "selector": "#email", "value": "a@b.com" } }` |
| `click` | Click an element by CSS selector. | `{ "click": { "selector": "button.submit" } }` |
| `assert` | Assert JS expression is truthy. `retry` enables polling. | `{ "assert": "document.title === 'Home'", "retry": { "interval": 500, "timeout": 5000 } }` |
| `wait` | Sleep for N milliseconds. | `{ "wait": 1000 }` |
| `wait_for` | Poll for element existence by CSS selector. | `{ "wait_for": { "selector": ".loaded", "timeout": 10000 } }` |
| `console_check` | Fail if console messages at given levels exist. | `{ "console_check": ["error", "warning"] }` |
| `network_check` | Fail if any 4xx/5xx responses captured. | `{ "network_check": true }` |
| `mock_network` | Intercept requests matching glob, return mock. | `{ "mock_network": { "match": "*api/*", "status": 200, "body": {} } }` |
| `run_test` | Execute another saved test inline. | `{ "run_test": "login-flow" }` |

## Development

```bash
npm run dev          # Run MCP server with tsx
npm test             # Run tests in watch mode
npx vitest run       # Run all tests once
cd gui && npm run dev  # GUI dev server with hot reload
```

## Project Structure

```
src/
  server.ts          # MCP server entry, tool definitions
  step-runner.ts     # Test execution engine (runTest, runSteps)
  cdp-client.ts      # Chrome DevTools Protocol wrapper
  api-server.ts      # HTTP API + WebSocket for GUI
  cli.ts             # CLI entry point
  types.ts           # Core type definitions
  env.ts             # $env/$vars string interpolation
  storage.ts         # File-based test & result persistence
gui/
  src/
    features/tests/  # Test detail, steps tab
    features/runs/   # Run button, log panel
    features/history/# Results history
    components/      # Shared UI (RunInputsDialog, Layout, etc.)
    lib/             # API client, types
    stores/          # Zustand stores (run-store)
```

## License

MIT
