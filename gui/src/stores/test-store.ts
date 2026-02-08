/**
 * Test Store using Zustand
 * Manages the state of all saved tests, including selection, loading state, and CRUD operations
 * Integrates with the API client for persistence
 */

import { create } from 'zustand';
import type { SavedTest } from '../lib/types.js';
import * as api from '../lib/api.js';

/**
 * Test Store State and Actions
 */
export interface TestStore {
  // State
  tests: SavedTest[];
  selectedTestId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setTests: (tests: SavedTest[]) => void;
  selectTest: (testId: string | null) => void;
  addTest: (test: SavedTest) => void;
  deleteTest: (testId: string) => void;
  updateTest: (test: SavedTest) => void;
  fetchTests: () => Promise<void>;
  saveTest: (test: SavedTest) => Promise<void>;
  deleteTestRemote: (testId: string) => Promise<void>;
  setError: (error: string | null) => void;
}

/**
 * Create the test store with Zustand
 * Provides centralized test state management with API integration
 */
export const useTestStore = create<TestStore>((set, get) => ({
  // Initial state
  tests: [],
  selectedTestId: null,
  isLoading: false,
  error: null,

  /**
   * Set the tests array directly
   */
  setTests: (tests: SavedTest[]) => {
    set({ tests });
  },

  /**
   * Select a test by ID
   */
  selectTest: (testId: string | null) => {
    set({ selectedTestId: testId });
  },

  /**
   * Add a test to the local state
   */
  addTest: (test: SavedTest) => {
    const state = get();
    // Prevent duplicates by removing if already exists
    const filtered = state.tests.filter((t) => t.id !== test.id);
    set({ tests: [...filtered, test] });
  },

  /**
   * Delete a test from local state
   */
  deleteTest: (testId: string) => {
    const state = get();
    set({
      tests: state.tests.filter((t) => t.id !== testId),
      selectedTestId:
        state.selectedTestId === testId ? null : state.selectedTestId,
    });
  },

  /**
   * Update a test in local state
   */
  updateTest: (test: SavedTest) => {
    const state = get();
    set({
      tests: state.tests.map((t) => (t.id === test.id ? test : t)),
    });
  },

  /**
   * Fetch all tests from the API and populate the store
   */
  fetchTests: async () => {
    set({ isLoading: true, error: null });
    try {
      const tests = await api.listTests();
      set({ tests, isLoading: false });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch tests';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  /**
   * Save a test to the API and update local state
   */
  saveTest: async (test: SavedTest) => {
    set({ error: null });
    try {
      await api.saveTest(test);
      get().updateTest(test);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to save test';
      set({ error: message });
      throw error;
    }
  },

  /**
   * Delete a test from the API and local state
   */
  deleteTestRemote: async (testId: string) => {
    set({ error: null });
    try {
      await api.deleteTest(testId);
      get().deleteTest(testId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to delete test';
      set({ error: message });
      throw error;
    }
  },

  /**
   * Set error message
   */
  setError: (error: string | null) => {
    set({ error });
  },
}));
