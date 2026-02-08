/**
 * UI Store using Zustand
 * Manages global UI state including sidebar visibility and search query
 * Provides a centralized state management for UI-level concerns
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * UI Store State and Actions
 */
export interface UIStore {
  // State
  sidebarOpen: boolean;
  searchQuery: string;
  chromeConnected: boolean;

  // Actions
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSearchQuery: (query: string) => void;
}

/**
 * Create the UI store with Zustand
 * Includes persistence middleware to save preferences to localStorage
 */
export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      // Initial state
      sidebarOpen: true,
      searchQuery: '',
      chromeConnected: false,

      /**
       * Toggle the sidebar visibility
       */
      toggleSidebar: () => {
        set((state) => ({
          sidebarOpen: !state.sidebarOpen,
        }));
      },

      /**
       * Set sidebar visibility explicitly
       */
      setSidebarOpen: (open: boolean) => {
        set({ sidebarOpen: open });
      },

      /**
       * Update the search query for filtering tests
       */
      setSearchQuery: (query: string) => {
        set({ searchQuery: query });
      },
    }),
    {
      name: 'ui-store', // localStorage key
      version: 1, // Schema version for migrations
    }
  )
);
