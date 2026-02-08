#!/usr/bin/env node

/**
 * CLI entry point for chromedev-director
 * Enables: npx chromedev-director gui [options]
 */

import { startGui } from './api-server.js';

/**
 * Parse command-line arguments for the 'gui' subcommand
 */
function parseArgs(): {
  command: string | null;
  port: number;
  cdpPort: number;
  projectRoot: string;
  showHelp: boolean;
} {
  const args = process.argv.slice(2);
  let command: string | null = null;
  let port = 3000;
  let cdpPort = 9222;
  let projectRoot = process.cwd();
  let showHelp = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (arg === '--port') {
      const val = args[++i];
      if (val !== undefined) {
        const parsed = parseInt(val, 10);
        if (!isNaN(parsed)) {
          port = parsed;
        }
      }
    } else if (arg === '--chrome-port' || arg === '--cdp-port') {
      const val = args[++i];
      if (val !== undefined) {
        const parsed = parseInt(val, 10);
        if (!isNaN(parsed)) {
          cdpPort = parsed;
        }
      }
    } else if (arg === '--project-root') {
      const val = args[++i];
      if (val !== undefined) {
        projectRoot = val;
      }
    } else if (!arg.startsWith('-')) {
      // First non-flag argument is the command
      if (!command) {
        command = arg;
      }
    }
  }

  return { command, port, cdpPort, projectRoot, showHelp };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
chromedev-director - Chrome DevTools Protocol test runner and GUI

USAGE:
  npx chromedev-director gui [OPTIONS]

COMMANDS:
  gui                    Start the GUI server

OPTIONS:
  --port <number>        HTTP server port (default: 3000)
  --chrome-port <number> Chrome DevTools Protocol port (default: 9222)
  --project-root <path>  Project root directory (default: cwd)
  --help, -h             Show this help message

EXAMPLES:
  npx chromedev-director gui
  npx chromedev-director gui --port 8000
  npx chromedev-director gui --chrome-port 9333
  npx chromedev-director gui --port 8000 --chrome-port 9333 --project-root ./my-project
`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const { command, port, cdpPort, projectRoot, showHelp } = parseArgs();

  if (showHelp || !command) {
    printHelp();
    process.exit(0);
  }

  if (command !== 'gui') {
    console.error(`Error: Unknown command '${command}'`);
    console.error(`Run 'npx chromedev-director --help' for usage information`);
    process.exit(1);
  }

  try {
    await startGui({
      port,
      cdpPort,
      projectRoot,
    });
  } catch (error) {
    console.error('Error starting GUI:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
