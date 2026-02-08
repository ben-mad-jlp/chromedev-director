/**
 * Unit tests for MCP server tools
 * Tests CRUD operations, result queries, and test execution (both inline and testId-based)
 *
 * These tests focus on the tool implementations and storage layer rather than
 * testing the MCP protocol dispatcher directly. This is pragmatic as it tests
 * the actual business logic that matters to users.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as storageModule from './storage.js';
import * as fs from 'fs/promises';
import path from 'path';
import { TestDef, TestResult, SavedTest, TestRun } from './types.js';

/**
 * Helper to create a temporary storage directory for testing
 */
async function createTestStorage(): Promise<string> {
  const tempDir = path.join('/tmp', `test-storage-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  await fs.mkdir(tempDir, { recursive: true });
  await fs.mkdir(path.join(tempDir, 'tests'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'results'), { recursive: true });
  return tempDir;
}

/**
 * Helper to clean up test storage
 */
async function cleanupTestStorage(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Simple test definition for testing
 */
const simpleTestDef: TestDef = {
  url: 'https://example.com',
  steps: [
    { label: 'Check title', eval: 'document.title', as: 'title' },
    { label: 'Assert success', assert: 'true' },
  ],
};

/**
 * Helper to generate ID from name (matches server.ts logic)
 */
function generateTestId(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

describe('MCP Server Tools - Storage Layer', () => {
  let storageDir: string;

  beforeEach(async () => {
    storageDir = await createTestStorage();
  });

  afterEach(async () => {
    await cleanupTestStorage(storageDir);
  });

  describe('save_test - Test Definition Storage', () => {
    it('should save a test with name and definition', async () => {
      const testId = 'login-flow';
      const result = await storageModule.saveTest(
        storageDir,
        testId,
        'Login Flow',
        simpleTestDef
      );

      expect(result).toHaveProperty('id', testId);
      expect(result).toHaveProperty('name', 'Login Flow');
      expect(result).toHaveProperty('definition');
      expect(result.definition).toEqual(simpleTestDef);
    });

    it('should save a test with optional description and tags', async () => {
      const testId = 'auth-test';
      const result = await storageModule.saveTest(
        storageDir,
        testId,
        'Auth Test',
        simpleTestDef,
        {
          description: 'Tests authentication flow',
          tags: ['auth', 'smoke'],
        }
      );

      expect(result.id).toBe('auth-test');
      expect(result.name).toBe('Auth Test');
      expect(result.description).toBe('Tests authentication flow');
      expect(result.tags).toEqual(['auth', 'smoke']);
    });

    it('should reject duplicate test IDs', async () => {
      const testId = 'dup-test';

      // First save succeeds
      await storageModule.saveTest(storageDir, testId, 'First', simpleTestDef);

      // Second save with same ID should fail
      try {
        await storageModule.saveTest(storageDir, testId, 'Second', simpleTestDef);
        expect.fail('Should have thrown on duplicate ID');
      } catch (error) {
        expect((error as Error).message).toContain('Test ID already exists');
      }
    });

    it('should store test metadata with timestamps', async () => {
      const testId = 'timestamped';
      const result = await storageModule.saveTest(storageDir, testId, 'Test', simpleTestDef);

      expect(result).toHaveProperty('createdAt');
      expect(result).toHaveProperty('updatedAt');
      expect(typeof result.createdAt).toBe('string');
      expect(typeof result.updatedAt).toBe('string');
      expect(new Date(result.createdAt).getTime()).toBeGreaterThan(0);
    });

    it('should persist test to disk in JSON format', async () => {
      const testId = 'persistent';
      await storageModule.saveTest(storageDir, testId, 'Test', simpleTestDef);

      const testPath = path.join(storageDir, 'tests', `${testId}.json`);
      const content = await fs.readFile(testPath, 'utf-8');
      const persisted = JSON.parse(content);

      expect(persisted.id).toBe(testId);
      expect(persisted.definition).toEqual(simpleTestDef);
    });
  });

  describe('list_tests - Test Discovery', () => {
    it('should return empty list when no tests exist', async () => {
      const result = await storageModule.listTests(storageDir);
      expect(result).toEqual([]);
    });

    it('should return all saved tests', async () => {
      // Save multiple tests
      await storageModule.saveTest(storageDir, 'test-one', 'Test One', simpleTestDef);
      await storageModule.saveTest(storageDir, 'test-two', 'Test Two', simpleTestDef);

      const result = await storageModule.listTests(storageDir);

      expect(result).toHaveLength(2);
      expect(result.map(t => t.id)).toContain('test-one');
      expect(result.map(t => t.id)).toContain('test-two');
    });

    it('should include full metadata in list', async () => {
      await storageModule.saveTest(
        storageDir,
        'full-test',
        'Full Test',
        simpleTestDef,
        { description: 'Test description', tags: ['smoke', 'e2e'] }
      );

      const result = await storageModule.listTests(storageDir);

      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('description', 'Test description');
      expect(result[0]).toHaveProperty('tags', ['smoke', 'e2e']);
      expect(result[0]).toHaveProperty('createdAt');
    });

    it('should support filtering by tag', async () => {
      await storageModule.saveTest(storageDir, 'smoke-1', 'Smoke 1', simpleTestDef, { tags: ['smoke'] });
      await storageModule.saveTest(storageDir, 'e2e-1', 'E2E 1', simpleTestDef, { tags: ['e2e'] });
      await storageModule.saveTest(storageDir, 'both', 'Both', simpleTestDef, { tags: ['smoke', 'e2e'] });

      const smokeTests = await storageModule.listTests(storageDir, { tag: 'smoke' });

      expect(smokeTests).toHaveLength(2);
      expect(smokeTests.map(t => t.id)).toContain('smoke-1');
      expect(smokeTests.map(t => t.id)).toContain('both');
    });

    it('should sort tests by most recent first', async () => {
      await storageModule.saveTest(storageDir, 'first', 'First', simpleTestDef);
      // Add a small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));
      await storageModule.saveTest(storageDir, 'second', 'Second', simpleTestDef);

      const result = await storageModule.listTests(storageDir);

      expect(result[0].id).toBe('second');
      expect(result[1].id).toBe('first');
    });
  });

  describe('get_test - Test Retrieval', () => {
    it('should retrieve a saved test by ID', async () => {
      const testId = 'retrieve-test';
      await storageModule.saveTest(storageDir, testId, 'My Test', simpleTestDef);

      const result = await storageModule.getTest(storageDir, testId);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(testId);
      expect(result!.name).toBe('My Test');
      expect(result!.definition).toEqual(simpleTestDef);
    });

    it('should return null when test not found', async () => {
      const result = await storageModule.getTest(storageDir, 'nonexistent');
      expect(result).toBeNull();
    });

    it('should return complete test with all metadata', async () => {
      const testId = 'complete-test';
      await storageModule.saveTest(
        storageDir,
        testId,
        'Complete',
        simpleTestDef,
        { description: 'A complete test', tags: ['critical'] }
      );

      const result = await storageModule.getTest(storageDir, testId);

      expect(result!.id).toBe(testId);
      expect(result!.name).toBe('Complete');
      expect(result!.description).toBe('A complete test');
      expect(result!.tags).toEqual(['critical']);
      expect(result!).toHaveProperty('createdAt');
      expect(result!).toHaveProperty('updatedAt');
    });
  });

  describe('delete_test - Test Deletion', () => {
    it('should delete a saved test', async () => {
      const testId = 'delete-me';
      await storageModule.saveTest(storageDir, testId, 'Delete Test', simpleTestDef);

      // Verify exists
      let result = await storageModule.getTest(storageDir, testId);
      expect(result).not.toBeNull();

      // Delete
      await storageModule.deleteTest(storageDir, testId);

      // Verify deleted
      result = await storageModule.getTest(storageDir, testId);
      expect(result).toBeNull();
    });

    it('should also delete associated results directory', async () => {
      const testId = 'delete-with-results';
      await storageModule.saveTest(storageDir, testId, 'Test', simpleTestDef);

      // Create a results directory for this test
      const resultsDir = path.join(storageDir, 'results', testId);
      await fs.mkdir(resultsDir, { recursive: true });
      await fs.writeFile(path.join(resultsDir, 'dummy.txt'), 'test');

      // Verify results exist
      expect(await fs.stat(resultsDir)).toBeDefined();

      // Delete test
      await storageModule.deleteTest(storageDir, testId);

      // Verify results directory is gone
      try {
        await fs.stat(resultsDir);
        expect.fail('Results directory should have been deleted');
      } catch (error) {
        expect((error as any).code).toBe('ENOENT');
      }
    });

    it('should be idempotent when test not found', async () => {
      // Should not throw when deleting nonexistent test
      await expect(storageModule.deleteTest(storageDir, 'nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('list_results - Result History', () => {
    it('should return empty list when test has no results', async () => {
      const result = await storageModule.listResults(storageDir, 'nonexistent-test');
      expect(result).toEqual([]);
    });

    it('should return all results for a test', async () => {
      const testId = 'test-with-results';
      const passResult: TestResult = { status: 'passed', steps_completed: 2, duration_ms: 1000 };
      const failResult: TestResult = {
        status: 'failed',
        failed_step: 1,
        step_definition: { eval: 'fail' },
        error: 'Test failed',
        console_errors: [],
        duration_ms: 500,
      };

      // Save results
      await storageModule.saveResult(storageDir, testId, passResult);
      await storageModule.saveResult(storageDir, testId, failResult);

      const results = await storageModule.listResults(storageDir, testId);

      expect(results).toHaveLength(2);
      expect(results.map(r => r.result.status)).toContain('passed');
      expect(results.map(r => r.result.status)).toContain('failed');
    });

    it('should support filtering by status', async () => {
      const testId = 'status-filter-test';
      const passResult: TestResult = { status: 'passed', steps_completed: 1, duration_ms: 1000 };
      const failResult: TestResult = {
        status: 'failed',
        failed_step: 0,
        step_definition: { eval: 'fail' },
        error: 'Failed',
        console_errors: [],
        duration_ms: 500,
      };

      await storageModule.saveResult(storageDir, testId, passResult);
      await storageModule.saveResult(storageDir, testId, failResult);

      const passedOnly = await storageModule.listResults(storageDir, testId, { status: 'passed' });
      expect(passedOnly).toHaveLength(1);
      expect(passedOnly[0].status).toBe('passed');

      const failedOnly = await storageModule.listResults(storageDir, testId, { status: 'failed' });
      expect(failedOnly).toHaveLength(1);
      expect(failedOnly[0].status).toBe('failed');
    });

    it('should support limiting result count', async () => {
      const testId = 'limit-test';
      const passResult: TestResult = { status: 'passed', steps_completed: 1, duration_ms: 1000 };

      // Save 3 results
      await storageModule.saveResult(storageDir, testId, passResult);
      await storageModule.saveResult(storageDir, testId, passResult);
      await storageModule.saveResult(storageDir, testId, passResult);

      const limited = await storageModule.listResults(storageDir, testId, { limit: 2 });

      expect(limited).toHaveLength(2);
    });

    it('should sort results by most recent first', async () => {
      const testId = 'sort-test';
      const result: TestResult = { status: 'passed', steps_completed: 1, duration_ms: 1000 };

      await storageModule.saveResult(storageDir, testId, result);
      await new Promise(resolve => setTimeout(resolve, 10));
      await storageModule.saveResult(storageDir, testId, result);

      const results = await storageModule.listResults(storageDir, testId);

      expect(results).toHaveLength(2);
      expect(new Date(results[0].startedAt).getTime())
        .toBeGreaterThanOrEqual(new Date(results[1].startedAt).getTime());
    });
  });

  describe('get_result - Result Retrieval', () => {
    it('should retrieve a specific run result', async () => {
      const testId = 'specific-result-test';
      const passResult: TestResult = { status: 'passed', steps_completed: 3, duration_ms: 2000 };

      const saved = await storageModule.saveResult(storageDir, testId, passResult);
      const retrieved = await storageModule.getResult(storageDir, testId, saved.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(saved.id);
      expect(retrieved!.result.status).toBe('passed');
      if (retrieved!.result.status === 'passed') {
        expect(retrieved!.result.steps_completed).toBe(3);
      }
    });

    it('should return null when result not found', async () => {
      const result = await storageModule.getResult(storageDir, 'test', 'nonexistent-run');
      expect(result).toBeNull();
    });

    it('should include full result details including errors', async () => {
      const testId = 'error-result-test';
      const failResult: TestResult = {
        status: 'failed',
        failed_step: 2,
        failed_label: 'Click button',
        step_definition: { click: { selector: '.btn' } },
        error: 'Element not found',
        console_errors: ['TypeError: Cannot read property X'],
        dom_snapshot: '<html><body>Error</body></html>',
        duration_ms: 1500,
      };

      const saved = await storageModule.saveResult(storageDir, testId, failResult);
      const retrieved = await storageModule.getResult(storageDir, testId, saved.id);

      expect(retrieved!.result).toHaveProperty('failed_step', 2);
      expect(retrieved!.result).toHaveProperty('error', 'Element not found');
      expect(retrieved!.result).toHaveProperty('console_errors');
      expect(retrieved!.result).toHaveProperty('dom_snapshot');
    });
  });

  describe('Test Definition Schema Validation', () => {
    it('should accept minimal test definition', async () => {
      const minimal: TestDef = {
        url: 'https://example.com',
        steps: [{ eval: 'true' }],
      };

      const result = await storageModule.saveTest(storageDir, 'minimal', 'Minimal', minimal);
      expect(result.definition).toEqual(minimal);
    });

    it('should accept full test definition with all fields', async () => {
      const full: TestDef = {
        url: 'https://example.com',
        env: { key: 'value' },
        before: [{ eval: 'setup()' }],
        after: [{ eval: 'cleanup()' }],
        steps: [{ eval: 'test()' }],
        timeout: 30000,
        resume_from: 1,
      };

      const result = await storageModule.saveTest(storageDir, 'full', 'Full', full);
      expect(result.definition).toEqual(full);
    });

    it('should preserve complex step definitions', async () => {
      const complexTest: TestDef = {
        url: 'https://example.com',
        steps: [
          { label: 'Step 1', fill: { selector: '#input', value: 'test' } },
          { label: 'Step 2', click: { selector: '#btn' } },
          { label: 'Step 3', assert: 'document.querySelector(".success")', retry: { interval: 500, timeout: 5000 } },
          { label: 'Step 4', wait_for: { selector: '.done', timeout: 10000 } },
          { label: 'Step 5', wait: 1000 },
          { label: 'Step 6', console_check: ['error', 'warning'] },
          { label: 'Step 7', network_check: true },
          { label: 'Step 8', mock_network: { match: '*api*', status: 200, body: { data: [] } } },
        ],
      };

      const result = await storageModule.saveTest(storageDir, 'complex', 'Complex', complexTest);
      expect(result.definition.steps).toHaveLength(8);
      expect(result.definition.steps[0]).toHaveProperty('fill');
      expect(result.definition.steps[7]).toHaveProperty('mock_network');
    });
  });

  describe('Test ID Generation (server.ts logic)', () => {
    it('should generate correct ID from test name', () => {
      expect(generateTestId('Login Flow')).toBe('login-flow');
      expect(generateTestId('My Complex Test (v2)')).toBe('my-complex-test-v2');
      // Note: dashes are preserved, so spaces become dashes and existing dashes remain
      expect(generateTestId('Test - With - Dashes')).toBe('test---with---dashes');
      // Leading and trailing dashes are preserved from spaces
      expect(generateTestId('  Spaces  ')).toBe('-spaces-');
    });

    it('should be idempotent', () => {
      const id1 = generateTestId('My Test');
      const id2 = generateTestId('My Test');
      expect(id1).toBe(id2);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle storage directory not existing gracefully', async () => {
      const nonexistent = path.join('/tmp', 'nonexistent-dir-' + Date.now());
      const result = await storageModule.listTests(nonexistent);
      expect(result).toEqual([]);
    });

    it('should handle corrupted JSON files by skipping them', async () => {
      // Create a corrupted test file
      const testPath = path.join(storageDir, 'tests', 'corrupted.json');
      await fs.writeFile(testPath, '{invalid json}');

      // Save a valid test
      await storageModule.saveTest(storageDir, 'valid', 'Valid', simpleTestDef);

      // List should skip corrupted and return valid
      const results = await storageModule.listTests(storageDir);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('valid');
    });

    it('should enforce result retention limits', async () => {
      const testId = 'retention-test';
      const result: TestResult = { status: 'passed', steps_completed: 1, duration_ms: 1000 };
      const limit = 3;

      // Save 5 results with retention limit of 3
      for (let i = 0; i < 5; i++) {
        await storageModule.saveResult(storageDir, testId, result, {}, limit);
      }

      // Check that only 3 results are kept
      const results = await storageModule.listResults(storageDir, testId);
      expect(results.length).toBeLessThanOrEqual(limit);
    });
  });

  describe('Integration: Full Test Lifecycle', () => {
    it('should handle complete test save and retrieve cycle', async () => {
      const testId = 'lifecycle-test';
      const name = 'Lifecycle Test';
      const description = 'Tests the full lifecycle';
      const tags = ['integration', 'test'];

      // 1. Save test
      const saved = await storageModule.saveTest(
        storageDir,
        testId,
        name,
        simpleTestDef,
        { description, tags }
      );

      expect(saved.id).toBe(testId);

      // 2. List tests and find it
      const all = await storageModule.listTests(storageDir);
      expect(all.length).toBeGreaterThan(0);
      expect(all.map(t => t.id)).toContain(testId);

      // 3. Get specific test
      const retrieved = await storageModule.getTest(storageDir, testId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe(name);
      expect(retrieved!.description).toBe(description);

      // 4. Save run results
      const passResult: TestResult = { status: 'passed', steps_completed: 2, duration_ms: 1000 };
      const runResult = await storageModule.saveResult(storageDir, testId, passResult);
      expect(runResult.id).toBeDefined();

      // 5. List results
      const results = await storageModule.listResults(storageDir, testId);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('passed');

      // 6. Get specific result
      const specificResult = await storageModule.getResult(storageDir, testId, runResult.id);
      expect(specificResult).not.toBeNull();
      expect(specificResult!.result.status).toBe('passed');

      // 7. Delete test (should also clean up results)
      await storageModule.deleteTest(storageDir, testId);

      // 8. Verify test is gone
      const afterDelete = await storageModule.getTest(storageDir, testId);
      expect(afterDelete).toBeNull();

      // 9. Verify results are gone
      const resultsAfterDelete = await storageModule.listResults(storageDir, testId);
      expect(resultsAfterDelete).toHaveLength(0);
    });
  });
});
