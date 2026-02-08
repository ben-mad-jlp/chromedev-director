/**
 * Storage layer for chromedev-director
 * Handles persistence of test definitions, run results, and test suites to disk
 */

import fs from 'fs/promises';
import path from 'path';
import { SavedTest, TestRun, TestResult, TestDef, DirectorConfig } from './types.js';

/**
 * Initialize the storage directory structure
 *
 * Creates `.chromedev-director/` directory in the project root with required subdirectories:
 * - tests/ — for test definitions
 * - results/ — for test run results
 *
 * Also creates a default config.json if it doesn't exist.
 *
 * @param config DirectorConfig with storageDir path
 * @throws {Error} If projectRoot is invalid, directories cannot be created, or permissions are insufficient
 */
export async function initStorage(config: DirectorConfig): Promise<void> {
  const { storageDir } = config;

  try {
    // Step 1: Validate that storageDir path is provided
    if (!storageDir || typeof storageDir !== 'string') {
      throw new Error('Invalid storage directory: storageDir must be a non-empty string');
    }

    // Step 2: Check if storage root exists, create if missing
    try {
      await fs.access(storageDir);
      const stats = await fs.stat(storageDir);
      if (!stats.isDirectory()) {
        throw new Error(`Storage path exists but is not a directory: ${storageDir}`);
      }
    } catch (error: unknown) {
      // Directory doesn't exist, create it
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        await fs.mkdir(storageDir, { recursive: true });
      } else if (error instanceof Error && !(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
        // Re-throw if it's not a "not found" error
        throw error;
      }
    }

    // Step 3: Create subdirectories (tests/ and results/)
    const testsDir = path.join(storageDir, 'tests');
    const resultsDir = path.join(storageDir, 'results');

    await fs.mkdir(testsDir, { recursive: true });
    await fs.mkdir(resultsDir, { recursive: true });

    // Step 4: Create default config.json if it doesn't exist
    const configPath = path.join(storageDir, 'config.json');
    try {
      await fs.access(configPath);
      // Config already exists, validate it
      const configContent = await fs.readFile(configPath, 'utf-8');
      JSON.parse(configContent);
    } catch (error: unknown) {
      // Config doesn't exist or is corrupted, create new one
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        const defaultConfig = {
          version: '1.0',
          resultRetention: 50,
        };
        await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
      } else {
        // If JSON parse failed or other IO error, warn but don't fail
        console.warn(`Warning: config.json is corrupted or unreadable at ${configPath}`);
      }
    }

    // Step 5: Verify all directories are readable and writable
    try {
      await fs.access(storageDir, fs.constants.R_OK | fs.constants.W_OK);
      await fs.access(testsDir, fs.constants.R_OK | fs.constants.W_OK);
      await fs.access(resultsDir, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
      throw new Error(`Storage directories are not readable/writable: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to initialize storage: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Save a test definition
 * Creates tests/{id}.json with metadata
 *
 * @param storageDir Root storage directory
 * @param id Slug-based test ID (must be unique)
 * @param name Human-readable test name
 * @param definition TestDef
 * @param opts Optional metadata (description, tags)
 * @returns Saved test with metadata
 * @throws {Error} If ID already exists or save fails
 */
export async function saveTest(
  storageDir: string,
  id: string,
  name: string,
  definition: TestDef,
  opts?: { description?: string; tags?: string[] }
): Promise<SavedTest> {
  validateId(id);
  const testPath = path.join(storageDir, 'tests', `${id}.json`);
  const now = new Date().toISOString();

  const savedTest: SavedTest = {
    id,
    name,
    description: opts?.description,
    tags: opts?.tags,
    definition,
    createdAt: now,
    updatedAt: now,
  };

  try {
    // Check if test already exists
    try {
      await fs.access(testPath);
      // File exists, so this is a duplicate
      throw new Error(`Test ID already exists: ${id}`);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('Test ID already exists')) {
        throw error;
      }
      // File doesn't exist (ENOENT), which is good
      if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
        throw error;
      }
    }

    // Write atomically (write to temp file, then rename)
    const tempPath = `${testPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(savedTest, null, 2), 'utf-8');
    await fs.rename(tempPath, testPath);

    return savedTest;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Test ID already exists')) {
      throw error;
    }
    throw new Error(`Failed to save test: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get a test definition by ID
 *
 * @param storageDir Root storage directory
 * @param id Test slug ID
 * @returns Saved test or null if not found
 */
export async function getTest(storageDir: string, id: string): Promise<SavedTest | null> {
  validateId(id);
  const testPath = path.join(storageDir, 'tests', `${id}.json`);

  try {
    const content = await fs.readFile(testPath, 'utf-8');
    const test = JSON.parse(content) as SavedTest;
    return test;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new Error(`Failed to get test: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * List all saved tests
 *
 * @param storageDir Root storage directory
 * @param filter Optional filter by tag
 * @returns Array of saved tests, sorted by updatedAt (newest first)
 */
export async function listTests(storageDir: string, filter?: { tag?: string }): Promise<SavedTest[]> {
  const testsDir = path.join(storageDir, 'tests');

  try {
    const files = await fs.readdir(testsDir);
    const tests: SavedTest[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const content = await fs.readFile(path.join(testsDir, file), 'utf-8');
        const test = JSON.parse(content) as SavedTest;

        // Apply tag filter if provided
        if (filter?.tag && (!test.tags || !test.tags.includes(filter.tag))) {
          continue;
        }

        tests.push(test);
      } catch (error) {
        // Skip corrupted files with a warning
        console.warn(`Warning: skipped corrupted test file: ${file}`);
      }
    }

    // Sort by updatedAt descending (newest first)
    tests.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return tests;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to list tests: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Update a test definition
 *
 * @param storageDir Root storage directory
 * @param id Test slug ID
 * @param updates Partial updates (name, description, tags, definition)
 * @returns Updated saved test
 * @throws {Error} If test not found or update fails
 */
export async function updateTest(
  storageDir: string,
  id: string,
  updates: Partial<Pick<SavedTest, 'name' | 'description' | 'tags' | 'definition'>>
): Promise<SavedTest> {
  validateId(id);
  const testPath = path.join(storageDir, 'tests', `${id}.json`);

  try {
    const content = await fs.readFile(testPath, 'utf-8');
    const test = JSON.parse(content) as SavedTest;

    const updatedTest: SavedTest = {
      ...test,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const tempPath = `${testPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(updatedTest, null, 2), 'utf-8');
    await fs.rename(tempPath, testPath);

    return updatedTest;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Test not found: ${id}`);
    }
    throw new Error(`Failed to update test: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Delete a test and all its run results
 *
 * @param storageDir Root storage directory
 * @param id Test slug ID
 */
export async function deleteTest(storageDir: string, id: string): Promise<void> {
  validateId(id);
  const testPath = path.join(storageDir, 'tests', `${id}.json`);
  const resultsDir = path.join(storageDir, 'results', id);

  try {
    // Delete test file
    await fs.unlink(testPath);

    // Delete results directory if it exists
    try {
      await fs.rm(resultsDir, { recursive: true, force: true });
    } catch {
      // Results directory might not exist, which is fine
    }
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Test file doesn't exist, which is idempotent
      return;
    }
    throw new Error(`Failed to delete test: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Global counter for ensuring unique run IDs within same millisecond
let runIdCounter = 0;

/**
 * Save a test run result
 *
 * @param storageDir Root storage directory
 * @param testId Test slug ID (must exist)
 * @param result TestResult from test execution
 * @param limit Optional result retention limit (default: 50)
 * @returns Saved test run
 * @throws {Error} If test not found or save fails
 */
export async function saveRun(
  storageDir: string,
  testId: string,
  result: TestResult,
  limit: number = 50
): Promise<TestRun> {
  validateId(testId);
  // Generate unique run ID based on ISO timestamp with counter for uniqueness
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const runId = `${timestamp}-${++runIdCounter}`;

  const testResultsDir = path.join(storageDir, 'results', testId);

  try {
    // Ensure results directory exists for this test
    await fs.mkdir(testResultsDir, { recursive: true });

    const testRun: TestRun = {
      id: runId,
      testId,
      status: result.status,
      result,
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      duration_ms: result.duration_ms,
    };

    // Write result file atomically
    const resultPath = path.join(testResultsDir, `${runId}.json`);
    const tempPath = `${resultPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(testRun, null, 2), 'utf-8');
    await fs.rename(tempPath, resultPath);

    // Enforce retention policy
    await enforceRetention(testResultsDir, limit);

    return testRun;
  } catch (error) {
    throw new Error(`Failed to save run: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * List all run results for a test
 *
 * @param storageDir Root storage directory
 * @param testId Test slug ID
 * @param filter Optional filter (status, limit)
 * @returns Array of test runs, sorted by startedAt (newest first)
 */
export async function listRuns(
  storageDir: string,
  testId: string,
  filter?: { status?: 'passed' | 'failed'; limit?: number }
): Promise<TestRun[]> {
  const testResultsDir = path.join(storageDir, 'results', testId);

  try {
    const files = await fs.readdir(testResultsDir);
    const runs: TestRun[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const content = await fs.readFile(path.join(testResultsDir, file), 'utf-8');
        const run = JSON.parse(content) as TestRun;

        // Apply status filter if provided
        if (filter?.status && run.status !== filter.status) {
          continue;
        }

        runs.push(run);
      } catch (error) {
        // Skip corrupted files
        console.warn(`Warning: skipped corrupted result file: ${file}`);
      }
    }

    // Sort by startedAt descending (newest first)
    runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    // Apply limit if provided
    if (filter?.limit) {
      runs.length = Math.min(runs.length, filter.limit);
    }

    return runs;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to list runs: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get the latest run result for a test
 *
 * @param storageDir Root storage directory
 * @param testId Test slug ID
 * @returns Latest test run or null if no runs exist
 */
export async function getLatestRun(storageDir: string, testId: string): Promise<TestRun | null> {
  const runs = await listRuns(storageDir, testId, { limit: 1 });
  return runs.length > 0 ? runs[0] : null;
}

/**
 * Get a specific run result by ID
 *
 * @param storageDir Root storage directory
 * @param testId Test slug ID
 * @param runId Run ID
 * @returns Test run or null if not found
 */
export async function getRun(storageDir: string, testId: string, runId: string): Promise<TestRun | null> {
  const runPath = path.join(storageDir, 'results', testId, `${runId}.json`);

  try {
    const content = await fs.readFile(runPath, 'utf-8');
    const run = JSON.parse(content) as TestRun;
    return run;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new Error(`Failed to get run: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Helper: Enforce result retention policy
 * Keeps only the most recent N results for a test
 *
 * @param testResultsDir Full path to test results directory
 * @param maxResults Maximum results to keep
 */
async function enforceRetention(testResultsDir: string, maxResults: number): Promise<void> {
  try {
    const files = await fs.readdir(testResultsDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    if (jsonFiles.length <= maxResults) {
      return;
    }

    // Read all files with their timestamps
    const filesWithTime: Array<{ name: string; time: number }> = [];

    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(testResultsDir, file), 'utf-8');
        const run = JSON.parse(content) as TestRun;
        filesWithTime.push({
          name: file,
          time: new Date(run.startedAt).getTime(),
        });
      } catch {
        // Skip corrupted files
      }
    }

    // Sort by time ascending (oldest first)
    filesWithTime.sort((a, b) => a.time - b.time);

    // Delete oldest files to reach maxResults
    const toDelete = filesWithTime.length - maxResults;
    for (let i = 0; i < toDelete; i++) {
      await fs.unlink(path.join(testResultsDir, filesWithTime[i].name));
    }
  } catch (error) {
    // Log warning but don't fail
    console.warn(`Warning: failed to enforce retention policy: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Save a test result (alias for saveRun with explicit function name)
 *
 * @param storageDir Root storage directory
 * @param testId Test slug ID (must exist)
 * @param result TestResult from test execution
 * @param nestedVersions Optional map of nested testId -> updatedAt timestamp at run time
 * @param limit Optional result retention limit (default: 50)
 * @returns Saved test run
 * @throws {Error} If save fails
 */
export async function saveResult(
  storageDir: string,
  testId: string,
  result: TestResult,
  nestedVersions?: Record<string, number>,
  limit: number = 50
): Promise<TestRun> {
  // Generate unique run ID based on ISO timestamp with counter for uniqueness
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const runId = `${timestamp}-${++runIdCounter}`;

  const testResultsDir = path.join(storageDir, 'results', testId);

  try {
    // Ensure results directory exists for this test
    await fs.mkdir(testResultsDir, { recursive: true });

    const testRun: TestRun = {
      id: runId,
      testId,
      status: result.status,
      result,
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      duration_ms: result.duration_ms,
    };

    // Write result file atomically
    const resultPath = path.join(testResultsDir, `${runId}.json`);
    const tempPath = `${resultPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(testRun, null, 2), 'utf-8');
    await fs.rename(tempPath, resultPath);

    // Enforce retention policy
    await enforceRetention(testResultsDir, limit);

    return testRun;
  } catch (error) {
    throw new Error(`Failed to save result: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * List all run results for a test (alias for listRuns)
 *
 * @param storageDir Root storage directory
 * @param testId Test slug ID
 * @param filter Optional filter (status, limit)
 * @returns Array of test runs, sorted by startedAt (newest first)
 */
export async function listResults(
  storageDir: string,
  testId: string,
  filter?: { status?: 'passed' | 'failed'; limit?: number }
): Promise<TestRun[]> {
  const testResultsDir = path.join(storageDir, 'results', testId);

  try {
    const files = await fs.readdir(testResultsDir);
    const runs: TestRun[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const content = await fs.readFile(path.join(testResultsDir, file), 'utf-8');
        const run = JSON.parse(content) as TestRun;

        // Apply status filter if provided
        if (filter?.status && run.status !== filter.status) {
          continue;
        }

        runs.push(run);
      } catch (error) {
        // Skip corrupted files
        console.warn(`Warning: skipped corrupted result file: ${file}`);
      }
    }

    // Sort by startedAt descending (newest first)
    runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    // Apply limit if provided
    if (filter?.limit) {
      runs.length = Math.min(runs.length, filter.limit);
    }

    return runs;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to list results: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get a specific result by ID (alias for getRun)
 *
 * @param storageDir Root storage directory
 * @param testId Test slug ID
 * @param runId Run ID
 * @returns Test run or null if not found
 */
export async function getResult(
  storageDir: string,
  testId: string,
  runId: string
): Promise<TestRun | null> {
  const resultPath = path.join(storageDir, 'results', testId, `${runId}.json`);

  try {
    const content = await fs.readFile(resultPath, 'utf-8');
    const run = JSON.parse(content) as TestRun;
    return run;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new Error(`Failed to get result: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Helper: Slugify a name to create a valid test ID
 *
 * @param name Human-readable name
 * @returns Slug (lowercase alphanumeric + hyphens)
 * @throws {Error} If slug is invalid or empty
 */
/**
 * Validate that an ID is safe for use in file paths (no path traversal)
 */
function validateId(id: string): void {
  if (id.includes('..') || id.includes('/') || id.includes('\\')) {
    throw new Error(`Invalid ID: contains path traversal characters: ${id}`);
  }
  if (id.length === 0) {
    throw new Error('Invalid ID: must not be empty');
  }
}

export function slugify(name: string): string {
  // Trim whitespace
  let slug = name.trim();

  // Convert to lowercase
  slug = slug.toLowerCase();

  // Replace spaces and special characters with dashes
  slug = slug.replace(/[^a-z0-9-]/g, '-');

  // Remove consecutive dashes
  slug = slug.replace(/-+/g, '-');

  // Remove leading/trailing dashes
  slug = slug.replace(/^-+|-+$/g, '');

  // Validate not empty
  if (!slug) {
    throw new Error('Invalid name: slug cannot be empty');
  }

  // Validate max length
  if (slug.length > 100) {
    throw new Error('Invalid name: slug cannot exceed 100 characters');
  }

  return slug;
}
