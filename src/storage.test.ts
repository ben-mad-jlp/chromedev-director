/**
 * Tests for the storage module
 * Covers directory initialization, test CRUD, result persistence, and retention policy
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  initStorage,
  saveTest,
  getTest,
  listTests,
  updateTest,
  deleteTest,
  saveRun,
  listRuns,
  getLatestRun,
  getRun,
  saveResult,
  listResults,
  getResult,
  slugify,
} from './storage.js';
import { TestDef, DirectorConfig, TestResult } from './types.js';

// Helper to create a temporary directory for tests
async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'storage-test-'));
}

// Helper to clean up test directory
async function cleanupDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// Sample test definition for testing
const sampleTestDef: TestDef = {
  url: 'https://example.com',
  steps: [
    { label: 'Check title', assert: 'document.title.length > 0' },
  ],
};

// Sample test result for testing
const sampleTestResult: TestResult = {
  status: 'passed',
  steps_completed: 1,
  duration_ms: 500,
  console_log: [],
  network_log: [],
};

describe('Storage Module', () => {
  let tempDir: string;
  let config: DirectorConfig;

  beforeEach(async () => {
    tempDir = await createTempDir();
    config = {
      storageDir: path.join(tempDir, '.chromedev-director'),
      resultRetentionDays: 30,
      port: 3000,
    };
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
  });

  describe('initStorage', () => {
    it('should create storage directory structure', async () => {
      await initStorage(config);

      // Verify root directory exists
      const rootStats = await fs.stat(config.storageDir);
      expect(rootStats.isDirectory()).toBe(true);

      // Verify subdirectories exist
      const testsDir = path.join(config.storageDir, 'tests');
      const resultsDir = path.join(config.storageDir, 'results');

      const testsDirStats = await fs.stat(testsDir);
      const resultsDirStats = await fs.stat(resultsDir);

      expect(testsDirStats.isDirectory()).toBe(true);
      expect(resultsDirStats.isDirectory()).toBe(true);
    });

    it('should create default config.json', async () => {
      await initStorage(config);

      const configPath = path.join(config.storageDir, 'config.json');
      const configContent = await fs.readFile(configPath, 'utf-8');
      const configObj = JSON.parse(configContent);

      expect(configObj).toHaveProperty('version');
      expect(configObj).toHaveProperty('resultRetention');
      expect(configObj.resultRetention).toBe(50);
    });

    it('should handle existing storage directory', async () => {
      await initStorage(config);
      // Call again with existing directory
      await initStorage(config);

      // Verify no errors and directory structure is intact
      const rootStats = await fs.stat(config.storageDir);
      expect(rootStats.isDirectory()).toBe(true);
    });

    it('should throw error for invalid config', async () => {
      const invalidConfig = { ...config, storageDir: '' };
      await expect(initStorage(invalidConfig)).rejects.toThrow();
    });
  });

  describe('saveTest', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should save a test with metadata', async () => {
      const savedTest = await saveTest(config.storageDir, 'login-test', 'Login Flow', sampleTestDef, {
        description: 'Test login functionality',
        tags: ['auth', 'smoke'],
      });

      expect(savedTest.id).toBe('login-test');
      expect(savedTest.name).toBe('Login Flow');
      expect(savedTest.description).toBe('Test login functionality');
      expect(savedTest.tags).toEqual(['auth', 'smoke']);
      expect(savedTest.definition).toEqual(sampleTestDef);
      expect(savedTest.createdAt).toBeDefined();
      expect(savedTest.updatedAt).toBeDefined();
    });

    it('should throw error on duplicate test ID', async () => {
      await saveTest(config.storageDir, 'duplicate-test', 'Test 1', sampleTestDef);
      await expect(
        saveTest(config.storageDir, 'duplicate-test', 'Test 2', sampleTestDef)
      ).rejects.toThrow('Test ID already exists');
    });

    it('should write test file to disk', async () => {
      await saveTest(config.storageDir, 'disk-test', 'Disk Test', sampleTestDef);

      const testPath = path.join(config.storageDir, 'tests', 'disk-test.json');
      const content = await fs.readFile(testPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.id).toBe('disk-test');
      expect(parsed.name).toBe('Disk Test');
    });
  });

  describe('getTest', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should retrieve saved test', async () => {
      await saveTest(config.storageDir, 'retrieve-test', 'Retrieve Test', sampleTestDef);
      const retrieved = await getTest(config.storageDir, 'retrieve-test');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('retrieve-test');
      expect(retrieved?.name).toBe('Retrieve Test');
    });

    it('should return null for nonexistent test', async () => {
      const retrieved = await getTest(config.storageDir, 'nonexistent');
      expect(retrieved).toBeNull();
    });
  });

  describe('listTests', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should list all saved tests', async () => {
      await saveTest(config.storageDir, 'test-1', 'Test One', sampleTestDef);
      await saveTest(config.storageDir, 'test-2', 'Test Two', sampleTestDef);

      const tests = await listTests(config.storageDir);
      expect(tests).toHaveLength(2);
      expect(tests[0].id).toMatch(/test-[12]/);
      expect(tests[1].id).toMatch(/test-[12]/);
    });

    it('should filter tests by tag', async () => {
      await saveTest(config.storageDir, 'smoke-test', 'Smoke Test', sampleTestDef, {
        tags: ['smoke'],
      });
      await saveTest(config.storageDir, 'auth-test', 'Auth Test', sampleTestDef, {
        tags: ['auth'],
      });

      const smokeTests = await listTests(config.storageDir, { tag: 'smoke' });
      expect(smokeTests).toHaveLength(1);
      expect(smokeTests[0].id).toBe('smoke-test');
    });

    it('should return empty array for empty storage', async () => {
      const tests = await listTests(config.storageDir);
      expect(tests).toEqual([]);
    });

    it('should sort by updatedAt descending', async () => {
      await saveTest(config.storageDir, 'test-1', 'Test One', sampleTestDef);
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
      await saveTest(config.storageDir, 'test-2', 'Test Two', sampleTestDef);

      const tests = await listTests(config.storageDir);
      expect(tests[0].id).toBe('test-2');
      expect(tests[1].id).toBe('test-1');
    });
  });

  describe('updateTest', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should update test metadata', async () => {
      await saveTest(config.storageDir, 'update-test', 'Original Name', sampleTestDef);

      const updated = await updateTest(config.storageDir, 'update-test', {
        name: 'Updated Name',
        description: 'New description',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.description).toBe('New description');
    });

    it('should throw error for nonexistent test', async () => {
      await expect(
        updateTest(config.storageDir, 'nonexistent', { name: 'Updated' })
      ).rejects.toThrow('Test not found');
    });
  });

  describe('deleteTest', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should delete test file', async () => {
      await saveTest(config.storageDir, 'delete-test', 'Delete Test', sampleTestDef);
      await deleteTest(config.storageDir, 'delete-test');

      const retrieved = await getTest(config.storageDir, 'delete-test');
      expect(retrieved).toBeNull();
    });

    it('should be idempotent (no error when deleting nonexistent test)', async () => {
      await expect(deleteTest(config.storageDir, 'nonexistent')).resolves.not.toThrow();
    });

    it('should also delete results directory', async () => {
      await saveTest(config.storageDir, 'result-test', 'Result Test', sampleTestDef);
      await saveRun(config.storageDir, 'result-test', sampleTestResult);

      const resultsDir = path.join(config.storageDir, 'results', 'result-test');
      expect(await fs.stat(resultsDir).then(() => true).catch(() => false)).toBe(true);

      await deleteTest(config.storageDir, 'result-test');

      expect(await fs.stat(resultsDir).then(() => true).catch(() => false)).toBe(false);
    });
  });

  describe('saveRun', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should save test run result', async () => {
      await saveTest(config.storageDir, 'run-test', 'Run Test', sampleTestDef);

      const savedRun = await saveRun(config.storageDir, 'run-test', sampleTestResult);

      expect(savedRun.testId).toBe('run-test');
      expect(savedRun.status).toBe('passed');
      expect(savedRun.result).toEqual(sampleTestResult);
    });

    it('should generate unique run IDs', async () => {
      await saveTest(config.storageDir, 'run-test', 'Run Test', sampleTestDef);

      const run1 = await saveRun(config.storageDir, 'run-test', sampleTestResult);
      const run2 = await saveRun(config.storageDir, 'run-test', sampleTestResult);

      expect(run1.id).not.toBe(run2.id);
    });

    it('should create results directory if missing', async () => {
      await saveTest(config.storageDir, 'new-run-test', 'New Run Test', sampleTestDef);
      const resultsDir = path.join(config.storageDir, 'results', 'new-run-test');

      // Directory shouldn't exist yet
      expect(await fs.stat(resultsDir).then(() => true).catch(() => false)).toBe(false);

      await saveRun(config.storageDir, 'new-run-test', sampleTestResult);

      // Directory should exist now
      expect(await fs.stat(resultsDir).then(() => true).catch(() => false)).toBe(true);
    });
  });

  describe('listRuns', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should list all runs for a test', async () => {
      await saveTest(config.storageDir, 'multi-run-test', 'Multi Run Test', sampleTestDef);

      await saveRun(config.storageDir, 'multi-run-test', sampleTestResult);
      await saveRun(config.storageDir, 'multi-run-test', sampleTestResult);

      const runs = await listRuns(config.storageDir, 'multi-run-test');
      expect(runs).toHaveLength(2);
    });

    it('should return empty array for test with no runs', async () => {
      await saveTest(config.storageDir, 'no-runs-test', 'No Runs Test', sampleTestDef);

      const runs = await listRuns(config.storageDir, 'no-runs-test');
      expect(runs).toEqual([]);
    });

    it('should sort runs by startedAt descending', async () => {
      await saveTest(config.storageDir, 'sorted-test', 'Sorted Test', sampleTestDef);

      await saveRun(config.storageDir, 'sorted-test', sampleTestResult);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await saveRun(config.storageDir, 'sorted-test', sampleTestResult);

      const runs = await listRuns(config.storageDir, 'sorted-test');
      expect(runs[0].startedAt > runs[1].startedAt).toBe(true);
    });
  });

  describe('getLatestRun', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should return latest run', async () => {
      await saveTest(config.storageDir, 'latest-test', 'Latest Test', sampleTestDef);

      const run1 = await saveRun(config.storageDir, 'latest-test', sampleTestResult);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const run2 = await saveRun(config.storageDir, 'latest-test', sampleTestResult);

      const latest = await getLatestRun(config.storageDir, 'latest-test');
      expect(latest?.id).toBe(run2.id);
    });

    it('should return null when no runs exist', async () => {
      await saveTest(config.storageDir, 'no-latest-test', 'No Latest Test', sampleTestDef);

      const latest = await getLatestRun(config.storageDir, 'no-latest-test');
      expect(latest).toBeNull();
    });
  });

  describe('getRun', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should retrieve specific run by ID', async () => {
      await saveTest(config.storageDir, 'get-run-test', 'Get Run Test', sampleTestDef);
      const savedRun = await saveRun(config.storageDir, 'get-run-test', sampleTestResult);

      const retrieved = await getRun(config.storageDir, 'get-run-test', savedRun.id);
      expect(retrieved?.id).toBe(savedRun.id);
    });

    it('should return null for nonexistent run', async () => {
      await saveTest(config.storageDir, 'missing-run-test', 'Missing Run Test', sampleTestDef);

      const retrieved = await getRun(config.storageDir, 'missing-run-test', 'nonexistent-run-id');
      expect(retrieved).toBeNull();
    });
  });

  describe('saveResult', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should save test result', async () => {
      await saveTest(config.storageDir, 'result-test', 'Result Test', sampleTestDef);

      const savedResult = await saveResult(config.storageDir, 'result-test', sampleTestResult);

      expect(savedResult.testId).toBe('result-test');
      expect(savedResult.status).toBe('passed');
      expect(savedResult.result).toEqual(sampleTestResult);
    });

    it('should generate unique result IDs', async () => {
      await saveTest(config.storageDir, 'result-test', 'Result Test', sampleTestDef);

      const result1 = await saveResult(config.storageDir, 'result-test', sampleTestResult);
      const result2 = await saveResult(config.storageDir, 'result-test', sampleTestResult);

      expect(result1.id).not.toBe(result2.id);
    });

    it('should enforce retention policy on save', async () => {
      await saveTest(config.storageDir, 'retention-test', 'Retention Test', sampleTestDef);

      // Save 3 results with limit of 2
      const result1 = await saveResult(config.storageDir, 'retention-test', sampleTestResult, undefined, 2);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const result2 = await saveResult(config.storageDir, 'retention-test', sampleTestResult, undefined, 2);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const result3 = await saveResult(config.storageDir, 'retention-test', sampleTestResult, undefined, 2);

      // List results and verify only 2 are kept (newest ones)
      const results = await listResults(config.storageDir, 'retention-test');
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe(result3.id);
      expect(results[1].id).toBe(result2.id);
    });
  });

  describe('listResults', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should list all results for a test', async () => {
      await saveTest(config.storageDir, 'multi-result-test', 'Multi Result Test', sampleTestDef);

      await saveResult(config.storageDir, 'multi-result-test', sampleTestResult);
      await saveResult(config.storageDir, 'multi-result-test', sampleTestResult);

      const results = await listResults(config.storageDir, 'multi-result-test');
      expect(results).toHaveLength(2);
    });

    it('should return empty array for test with no results', async () => {
      await saveTest(config.storageDir, 'no-results-test', 'No Results Test', sampleTestDef);

      const results = await listResults(config.storageDir, 'no-results-test');
      expect(results).toEqual([]);
    });

    it('should sort results by startedAt descending', async () => {
      await saveTest(config.storageDir, 'sorted-result-test', 'Sorted Result Test', sampleTestDef);

      await saveResult(config.storageDir, 'sorted-result-test', sampleTestResult);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await saveResult(config.storageDir, 'sorted-result-test', sampleTestResult);

      const results = await listResults(config.storageDir, 'sorted-result-test');
      expect(results[0].startedAt > results[1].startedAt).toBe(true);
    });

    it('should filter results by status', async () => {
      await saveTest(config.storageDir, 'filter-result-test', 'Filter Result Test', sampleTestDef);

      const passedResult: TestResult = {
        status: 'passed',
        steps_completed: 1,
        duration_ms: 500,
        console_log: [],
        network_log: [],
      };
      const failedResult: TestResult = {
        status: 'failed',
        failed_step: 1,
        step_definition: sampleTestDef.steps[0],
        error: 'Test failed',
        console_errors: [],
        duration_ms: 500,
        console_log: [],
        network_log: [],
      };

      await saveResult(config.storageDir, 'filter-result-test', passedResult);
      await saveResult(config.storageDir, 'filter-result-test', failedResult);

      const passedResults = await listResults(config.storageDir, 'filter-result-test', { status: 'passed' });
      const failedResults = await listResults(config.storageDir, 'filter-result-test', { status: 'failed' });

      expect(passedResults).toHaveLength(1);
      expect(passedResults[0].status).toBe('passed');
      expect(failedResults).toHaveLength(1);
      expect(failedResults[0].status).toBe('failed');
    });
  });

  describe('getResult', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should retrieve specific result by ID', async () => {
      await saveTest(config.storageDir, 'get-result-test', 'Get Result Test', sampleTestDef);
      const savedResult = await saveResult(config.storageDir, 'get-result-test', sampleTestResult);

      const retrieved = await getResult(config.storageDir, 'get-result-test', savedResult.id);
      expect(retrieved?.id).toBe(savedResult.id);
    });

    it('should return null for nonexistent result', async () => {
      await saveTest(config.storageDir, 'missing-result-test', 'Missing Result Test', sampleTestDef);

      const retrieved = await getResult(config.storageDir, 'missing-result-test', 'nonexistent-result-id');
      expect(retrieved).toBeNull();
    });

    it('should handle nonexistent test directory gracefully', async () => {
      const retrieved = await getResult(config.storageDir, 'nonexistent-test', 'some-result-id');
      expect(retrieved).toBeNull();
    });
  });

  describe('slugify', () => {
    it('should convert names to valid slugs', () => {
      expect(slugify('Login Flow')).toBe('login-flow');
      expect(slugify('Test-123')).toBe('test-123');
      expect(slugify('  Trim Spaces  ')).toBe('trim-spaces');
    });

    it('should handle special characters', () => {
      expect(slugify('Test@#$%')).toBe('test');
      expect(slugify('Hello_World')).toBe('hello-world');
    });

    it('should throw error for empty slug', () => {
      expect(() => slugify('   ')).toThrow('slug cannot be empty');
      expect(() => slugify('@#$%')).toThrow('slug cannot be empty');
    });

    it('should enforce max length', () => {
      const longName = 'a'.repeat(101);
      expect(() => slugify(longName)).toThrow('slug cannot exceed 100 characters');
    });

    it('should handle unicode characters', () => {
      // Unicode chars should be stripped/replaced
      const result = slugify('Café Test');
      expect(result).toMatch(/^[a-z0-9-]+$/);
    });

    it('should remove consecutive dashes', () => {
      expect(slugify('Test---Multiple---Dashes')).toBe('test-multiple-dashes');
    });

    it('should remove leading and trailing dashes', () => {
      expect(slugify('-test-name-')).toBe('test-name');
    });

    it('should handle numbers correctly', () => {
      expect(slugify('Test 123')).toBe('test-123');
      expect(slugify('001-Test')).toBe('001-test');
    });

    it('should handle single character names', () => {
      expect(slugify('A')).toBe('a');
    });

    it('should handle all dashes after processing', () => {
      expect(() => slugify('---')).toThrow('slug cannot be empty');
    });

    it('should exactly 100 chars at boundary', () => {
      const exactLength = 'a'.repeat(100);
      expect(slugify(exactLength)).toBe(exactLength);
    });
  });

  describe('File I/O and Atomicity', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should not create corrupted files on partial write failures', async () => {
      // Save a test successfully first
      await saveTest(config.storageDir, 'atomic-test', 'Atomic Test', sampleTestDef);

      // Verify file was written correctly
      const testPath = path.join(config.storageDir, 'tests', 'atomic-test.json');
      const content1 = await fs.readFile(testPath, 'utf-8');
      expect(() => JSON.parse(content1)).not.toThrow();

      // Update test
      await updateTest(config.storageDir, 'atomic-test', { name: 'Updated Atomic Test' });

      // Verify file is still valid JSON
      const content2 = await fs.readFile(testPath, 'utf-8');
      expect(() => JSON.parse(content2)).not.toThrow();
    });

    it('should not leave temporary files on success', async () => {
      await saveTest(config.storageDir, 'temp-file-test', 'Temp File Test', sampleTestDef);

      const testsDir = path.join(config.storageDir, 'tests');
      const files = await fs.readdir(testsDir);
      const tmpFiles = files.filter((f) => f.endsWith('.tmp'));

      expect(tmpFiles).toHaveLength(0);
    });
  });

  describe('Corruption Recovery', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should skip corrupted test files in listTests', async () => {
      await saveTest(config.storageDir, 'good-test', 'Good Test', sampleTestDef);

      // Create a corrupted file
      const corruptPath = path.join(config.storageDir, 'tests', 'corrupt.json');
      await fs.writeFile(corruptPath, 'invalid json {', 'utf-8');

      // List should still work and return only the good test
      const tests = await listTests(config.storageDir);
      expect(tests).toHaveLength(1);
      expect(tests[0].id).toBe('good-test');
    });

    it('should skip corrupted result files in listRuns', async () => {
      await saveTest(config.storageDir, 'corruption-test', 'Corruption Test', sampleTestDef);
      await saveRun(config.storageDir, 'corruption-test', sampleTestResult);

      // Create a corrupted result file
      const resultsDir = path.join(config.storageDir, 'results', 'corruption-test');
      const corruptPath = path.join(resultsDir, 'corrupt.json');
      await fs.writeFile(corruptPath, '{invalid json', 'utf-8');

      // List should still work
      const runs = await listRuns(config.storageDir, 'corruption-test');
      expect(runs).toHaveLength(1);
    });

    it('should skip corrupted result files in listResults', async () => {
      await saveTest(config.storageDir, 'list-results-test', 'List Results Test', sampleTestDef);
      await saveResult(config.storageDir, 'list-results-test', sampleTestResult);

      // Create a corrupted result file
      const resultsDir = path.join(config.storageDir, 'results', 'list-results-test');
      const corruptPath = path.join(resultsDir, 'corrupt.json');
      await fs.writeFile(corruptPath, 'broken[json', 'utf-8');

      // List should still work
      const results = await listResults(config.storageDir, 'list-results-test');
      expect(results).toHaveLength(1);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should handle saveTest with empty name', async () => {
      await expect(
        saveTest(config.storageDir, 'empty-name', '', sampleTestDef)
      ).resolves.not.toThrow();
    });

    it('should handle getTest with special characters in ID', async () => {
      const result = await getTest(config.storageDir, 'nonexistent@#$%');
      expect(result).toBeNull();
    });

    it('should handle deleteTest idempotency', async () => {
      await deleteTest(config.storageDir, 'nonexistent-test');
      // Should not throw
      await deleteTest(config.storageDir, 'nonexistent-test');
    });

    it('should handle saveRun with failed test result', async () => {
      const failedResult: TestResult = {
        status: 'failed',
        failed_step: 1,
        failed_label: 'Step failed',
        step_definition: sampleTestDef.steps[0],
        error: 'Assertion failed: expected true but got false',
        console_errors: ['Error: Something went wrong'],
        dom_snapshot: '<html><body>Failed</body></html>',
        duration_ms: 1000,
        console_log: [],
        network_log: [],
      };

      await saveTest(config.storageDir, 'failed-run-test', 'Failed Run Test', sampleTestDef);
      const run = await saveRun(config.storageDir, 'failed-run-test', failedResult);

      expect(run.status).toBe('failed');
      expect(run.result).toEqual(failedResult);
    });
  });

  describe('Multiple Tests and Results', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should maintain separate result directories for different tests', async () => {
      await saveTest(config.storageDir, 'test-a', 'Test A', sampleTestDef);
      await saveTest(config.storageDir, 'test-b', 'Test B', sampleTestDef);

      await saveRun(config.storageDir, 'test-a', sampleTestResult);
      await saveRun(config.storageDir, 'test-b', sampleTestResult);

      const runsA = await listRuns(config.storageDir, 'test-a');
      const runsB = await listRuns(config.storageDir, 'test-b');

      expect(runsA).toHaveLength(1);
      expect(runsB).toHaveLength(1);
      expect(runsA[0].testId).toBe('test-a');
      expect(runsB[0].testId).toBe('test-b');
    });

    it('should handle updating a test with existing runs', async () => {
      await saveTest(config.storageDir, 'multi-run-test', 'Multi Run Test', sampleTestDef);
      const run1 = await saveRun(config.storageDir, 'multi-run-test', sampleTestResult);

      // Update the test
      const updated = await updateTest(config.storageDir, 'multi-run-test', {
        name: 'Updated Multi Run Test',
        tags: ['updated'],
      });

      expect(updated.name).toBe('Updated Multi Run Test');

      // Runs should still exist
      const runs = await listRuns(config.storageDir, 'multi-run-test');
      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe(run1.id);
    });

    it('should delete all runs when deleting a test', async () => {
      await saveTest(config.storageDir, 'cleanup-test', 'Cleanup Test', sampleTestDef);

      // Save multiple runs
      await saveRun(config.storageDir, 'cleanup-test', sampleTestResult);
      await saveRun(config.storageDir, 'cleanup-test', sampleTestResult);
      await saveRun(config.storageDir, 'cleanup-test', sampleTestResult);

      const runsBefore = await listRuns(config.storageDir, 'cleanup-test');
      expect(runsBefore).toHaveLength(3);

      // Delete test
      await deleteTest(config.storageDir, 'cleanup-test');

      // All runs should be gone
      const runsAfter = await listRuns(config.storageDir, 'cleanup-test');
      expect(runsAfter).toHaveLength(0);
    });
  });

  describe('Retention Policy', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should keep only maxResults results when limit is enforced', async () => {
      await saveTest(config.storageDir, 'retention-exact', 'Retention Exact', sampleTestDef);

      // Save 5 results with retention limit of 3
      const results = [];
      for (let i = 0; i < 5; i++) {
        const result = await saveResult(config.storageDir, 'retention-exact', sampleTestResult, undefined, 3);
        results.push(result.id);
        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      // List and verify only 3 are kept
      const kept = await listResults(config.storageDir, 'retention-exact');
      expect(kept).toHaveLength(3);

      // Verify the most recent 3 are kept (in order 4, 3, 2)
      expect(kept[0].id).toBe(results[4]);
      expect(kept[1].id).toBe(results[3]);
      expect(kept[2].id).toBe(results[2]);
    });

    it('should handle retention with mixed passed/failed results', async () => {
      await saveTest(config.storageDir, 'mixed-retention', 'Mixed Retention', sampleTestDef);

      const passedResult: TestResult = {
        status: 'passed',
        steps_completed: 1,
        duration_ms: 500,
        console_log: [],
        network_log: [],
      };

      const failedResult: TestResult = {
        status: 'failed',
        failed_step: 1,
        step_definition: sampleTestDef.steps[0],
        error: 'Failed',
        console_errors: [],
        duration_ms: 500,
        console_log: [],
        network_log: [],
      };

      // Alternate between passed and failed
      for (let i = 0; i < 5; i++) {
        const result = i % 2 === 0 ? passedResult : failedResult;
        await saveResult(config.storageDir, 'mixed-retention', result, undefined, 2);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const kept = await listResults(config.storageDir, 'mixed-retention');
      expect(kept).toHaveLength(2);
    });
  });

  describe('Tag Filtering', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should filter tests by single tag', async () => {
      await saveTest(config.storageDir, 'smoke-1', 'Smoke Test 1', sampleTestDef, { tags: ['smoke'] });
      await saveTest(config.storageDir, 'smoke-2', 'Smoke Test 2', sampleTestDef, { tags: ['smoke'] });
      await saveTest(config.storageDir, 'auth-1', 'Auth Test', sampleTestDef, { tags: ['auth'] });

      const smokeTags = await listTests(config.storageDir, { tag: 'smoke' });
      expect(smokeTags).toHaveLength(2);
      expect(smokeTags.every((t) => t.tags?.includes('smoke'))).toBe(true);

      const authTests = await listTests(config.storageDir, { tag: 'auth' });
      expect(authTests).toHaveLength(1);
    });

    it('should return empty array for non-matching tag', async () => {
      await saveTest(config.storageDir, 'tag-test', 'Tag Test', sampleTestDef, { tags: ['smoke'] });

      const results = await listTests(config.storageDir, { tag: 'regression' });
      expect(results).toHaveLength(0);
    });

    it('should handle tests without tags', async () => {
      await saveTest(config.storageDir, 'no-tags', 'No Tags Test', sampleTestDef);

      const results = await listTests(config.storageDir, { tag: 'smoke' });
      expect(results).toHaveLength(0);
    });

    it('should handle multiple tags on a test', async () => {
      await saveTest(config.storageDir, 'multi-tag', 'Multi Tag Test', sampleTestDef, {
        tags: ['smoke', 'auth', 'critical'],
      });

      const smokeResults = await listTests(config.storageDir, { tag: 'smoke' });
      const authResults = await listTests(config.storageDir, { tag: 'auth' });
      const criticalResults = await listTests(config.storageDir, { tag: 'critical' });

      expect(smokeResults).toHaveLength(1);
      expect(authResults).toHaveLength(1);
      expect(criticalResults).toHaveLength(1);
    });
  });

  describe('Status Filtering', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should filter results by passed status', async () => {
      await saveTest(config.storageDir, 'status-test', 'Status Test', sampleTestDef);

      const passedResult: TestResult = {
        status: 'passed',
        steps_completed: 1,
        duration_ms: 500,
        console_log: [],
        network_log: [],
      };

      await saveResult(config.storageDir, 'status-test', passedResult);
      await saveResult(config.storageDir, 'status-test', passedResult);

      const results = await listResults(config.storageDir, 'status-test', { status: 'passed' });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.status === 'passed')).toBe(true);
    });

    it('should filter results by failed status', async () => {
      await saveTest(config.storageDir, 'failed-status-test', 'Failed Status Test', sampleTestDef);

      const failedResult: TestResult = {
        status: 'failed',
        failed_step: 1,
        step_definition: sampleTestDef.steps[0],
        error: 'Failed',
        console_errors: [],
        duration_ms: 500,
        console_log: [],
        network_log: [],
      };

      await saveResult(config.storageDir, 'failed-status-test', failedResult);

      const results = await listResults(config.storageDir, 'failed-status-test', { status: 'failed' });
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('failed');
    });

    it('should return empty for non-matching status filter', async () => {
      await saveTest(config.storageDir, 'no-match-status', 'No Match Status', sampleTestDef);

      const passedResult: TestResult = {
        status: 'passed',
        steps_completed: 1,
        duration_ms: 500,
        console_log: [],
        network_log: [],
      };

      await saveResult(config.storageDir, 'no-match-status', passedResult);

      const results = await listResults(config.storageDir, 'no-match-status', { status: 'failed' });
      expect(results).toHaveLength(0);
    });
  });

  describe('Limit Filtering', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should respect limit parameter in listRuns', async () => {
      await saveTest(config.storageDir, 'limit-test', 'Limit Test', sampleTestDef);

      // Save 5 runs
      for (let i = 0; i < 5; i++) {
        await saveRun(config.storageDir, 'limit-test', sampleTestResult);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const allRuns = await listRuns(config.storageDir, 'limit-test');
      expect(allRuns).toHaveLength(5);

      const limitedRuns = await listRuns(config.storageDir, 'limit-test', { limit: 2 });
      expect(limitedRuns).toHaveLength(2);

      // Should return the newest ones
      expect(limitedRuns[0].id).toBe(allRuns[0].id);
      expect(limitedRuns[1].id).toBe(allRuns[1].id);
    });

    it('should respect limit parameter in listResults', async () => {
      await saveTest(config.storageDir, 'limit-results', 'Limit Results', sampleTestDef);

      // Save 5 results
      for (let i = 0; i < 5; i++) {
        await saveResult(config.storageDir, 'limit-results', sampleTestResult);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const allResults = await listResults(config.storageDir, 'limit-results');
      expect(allResults).toHaveLength(5);

      const limitedResults = await listResults(config.storageDir, 'limit-results', { limit: 3 });
      expect(limitedResults).toHaveLength(3);
    });
  });

  describe('Timestamp Handling', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should preserve createdAt and only update updatedAt', async () => {
      const test1 = await saveTest(config.storageDir, 'timestamp-test', 'Timestamp Test', sampleTestDef);
      const createdAt1 = test1.createdAt;

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 50));

      const test2 = await updateTest(config.storageDir, 'timestamp-test', { name: 'Updated' });

      expect(test2.createdAt).toBe(createdAt1);
      expect(new Date(test2.updatedAt).getTime()).toBeGreaterThan(new Date(createdAt1).getTime());
    });

    it('should store ISO 8601 formatted timestamps', async () => {
      const test = await saveTest(config.storageDir, 'iso-test', 'ISO Test', sampleTestDef);

      // Verify ISO 8601 format
      const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      expect(isoRegex.test(test.createdAt)).toBe(true);
      expect(isoRegex.test(test.updatedAt)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should handle test names with numbers', async () => {
      const test = await saveTest(config.storageDir, 'test-123-abc', 'Test 123 ABC', sampleTestDef);
      expect(test.id).toBe('test-123-abc');
      expect(test.name).toBe('Test 123 ABC');
    });

    it('should handle very long descriptions', async () => {
      const longDesc = 'A'.repeat(5000);
      const test = await saveTest(config.storageDir, 'long-desc', 'Long Desc', sampleTestDef, {
        description: longDesc,
      });

      expect(test.description).toBe(longDesc);

      const retrieved = await getTest(config.storageDir, 'long-desc');
      expect(retrieved?.description).toBe(longDesc);
    });

    it('should handle TestDef with many steps', async () => {
      const largeTestDef: TestDef = {
        url: 'https://example.com',
        steps: Array.from({ length: 100 }, (_, i) => ({
          label: `Step ${i}`,
          assert: `true`,
        })),
      };

      const test = await saveTest(config.storageDir, 'many-steps', 'Many Steps', largeTestDef);
      expect(test.definition.steps).toHaveLength(100);

      const retrieved = await getTest(config.storageDir, 'many-steps');
      expect(retrieved?.definition.steps).toHaveLength(100);
    });

    it('should handle empty array of tags', async () => {
      const test = await saveTest(config.storageDir, 'empty-tags', 'Empty Tags', sampleTestDef, {
        tags: [],
      });

      expect(test.tags).toEqual([]);
    });

    it('should handle special test result with all fields', async () => {
      await saveTest(config.storageDir, 'complete-result', 'Complete Result', sampleTestDef);

      const completeResult: TestResult = {
        status: 'failed',
        failed_step: 2,
        failed_label: 'Check title',
        step_definition: { label: 'Check title', assert: 'document.title.length > 0' },
        error: 'Assertion failed: document.title.length > 0',
        console_errors: ['Error 1', 'Error 2', 'Error 3'],
        dom_snapshot: '<html><head><title>Test</title></head><body><div id="test">Content</div></body></html>',
        duration_ms: 2500,
        console_log: [],
        network_log: [],
      };

      const savedResult = await saveResult(config.storageDir, 'complete-result', completeResult);
      const retrieved = await getResult(config.storageDir, 'complete-result', savedResult.id);

      expect(retrieved?.result).toEqual(completeResult);
    });

    it('should maintain order when saving multiple tests rapidly', async () => {
      const ids = [];
      for (let i = 0; i < 10; i++) {
        const id = `rapid-test-${i}`;
        await saveTest(config.storageDir, id, `Rapid Test ${i}`, sampleTestDef);
        ids.push(id);
        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const tests = await listTests(config.storageDir);
      // Tests should be sorted by updatedAt descending, so most recent first
      expect(tests[0].id).toBe(ids[ids.length - 1]);
    });
  });

  describe('Directory Operations', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should handle re-initialization gracefully', async () => {
      await initStorage(config);
      await initStorage(config);
      await initStorage(config);

      // Should not throw and directory structure should be intact
      const tests = await listTests(config.storageDir);
      expect(tests).toEqual([]);
    });

    it('should verify storage directories are readable and writable', async () => {
      // After initStorage, directories should be accessible
      const storageDirStats = await fs.stat(config.storageDir);
      expect(storageDirStats.isDirectory()).toBe(true);

      const testsDirStats = await fs.stat(path.join(config.storageDir, 'tests'));
      expect(testsDirStats.isDirectory()).toBe(true);

      const resultsDirStats = await fs.stat(path.join(config.storageDir, 'results'));
      expect(resultsDirStats.isDirectory()).toBe(true);
    });
  });

  describe('Combined Operations', () => {
    beforeEach(async () => {
      await initStorage(config);
    });

    it('should support a complete workflow: create, run, update, retrieve, delete', async () => {
      // 1. Create test
      const created = await saveTest(config.storageDir, 'workflow-test', 'Workflow Test', sampleTestDef, {
        description: 'Test workflow',
        tags: ['workflow'],
      });
      expect(created.id).toBe('workflow-test');

      // 2. Save run result
      const run = await saveRun(config.storageDir, 'workflow-test', sampleTestResult);
      expect(run.testId).toBe('workflow-test');

      // 3. Update test
      const updated = await updateTest(config.storageDir, 'workflow-test', {
        description: 'Updated workflow test',
      });
      expect(updated.description).toBe('Updated workflow test');

      // 4. Get test
      const retrieved = await getTest(config.storageDir, 'workflow-test');
      expect(retrieved?.description).toBe('Updated workflow test');

      // 5. List tests
      const tests = await listTests(config.storageDir);
      expect(tests).toHaveLength(1);

      // 6. Get runs
      const runs = await listRuns(config.storageDir, 'workflow-test');
      expect(runs).toHaveLength(1);

      // 7. Delete test
      await deleteTest(config.storageDir, 'workflow-test');

      // 8. Verify deletion
      const deletedTest = await getTest(config.storageDir, 'workflow-test');
      expect(deletedTest).toBeNull();

      const deletedRuns = await listRuns(config.storageDir, 'workflow-test');
      expect(deletedRuns).toHaveLength(0);
    });

    it('should support saveResult workflow with status filtering and retention', async () => {
      // Create test
      await saveTest(config.storageDir, 'combined-workflow', 'Combined Workflow', sampleTestDef);

      // Save mixed results
      const passedResult: TestResult = {
        status: 'passed',
        steps_completed: 5,
        duration_ms: 1000,
        console_log: [],
        network_log: [],
      };

      const failedResult: TestResult = {
        status: 'failed',
        failed_step: 3,
        step_definition: sampleTestDef.steps[0],
        error: 'Failed at step 3',
        console_errors: [],
        duration_ms: 500,
        console_log: [],
        network_log: [],
      };

      // Save alternating results with retention
      for (let i = 0; i < 4; i++) {
        const result = i % 2 === 0 ? passedResult : failedResult;
        await saveResult(config.storageDir, 'combined-workflow', result, undefined, 3);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      // Get all results
      const allResults = await listResults(config.storageDir, 'combined-workflow');
      expect(allResults.length).toBeLessThanOrEqual(3);

      // Get passed results
      const passedResults = await listResults(config.storageDir, 'combined-workflow', { status: 'passed' });
      expect(passedResults.every((r) => r.status === 'passed')).toBe(true);

      // Get failed results
      const failedResults = await listResults(config.storageDir, 'combined-workflow', { status: 'failed' });
      expect(failedResults.every((r) => r.status === 'failed')).toBe(true);

      // Get with limit
      const limited = await listResults(config.storageDir, 'combined-workflow', { limit: 1 });
      expect(limited).toHaveLength(1);
    });
  });
});
