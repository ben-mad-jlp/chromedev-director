import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import TestList from '@/features/tests/TestList';
import type { SavedTest } from '@/lib/types';
import * as api from '@/lib/api';

/**
 * Sidebar component
 *
 * Displays:
 * - Search input for filtering tests
 * - Scrollable test list (uses TestList component)
 * - Optional settings/about links at bottom
 *
 * Features:
 * - Wired to ui-store for search query and sidebar state
 * - Fetches and displays saved tests
 * - Search filtering on test name, description, and tags
 * - Loading and error states
 * - Settings and about links (optional)
 */
export const Sidebar: React.FC = () => {
  const { searchQuery, setSearchQuery } = useUIStore();
  const [tests, setTests] = useState<SavedTest[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch tests on mount
  useEffect(() => {
    const fetchTests = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const fetchedTests = await api.listTests();
        setTests(fetchedTests);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load tests'
        );
        setTests([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTests();
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleSelectTest = (test: SavedTest) => {
    setSelectedTestId(test.id);
  };

  return (
    <div className="w-full h-full flex flex-col bg-white">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex-shrink-0">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Tests</h2>

        {/* Search input */}
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            placeholder="Search tests..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-md bg-gray-50 text-sm placeholder-gray-500 focus:bg-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
          />
        </div>
      </div>

      {/* Tests list */}
      <div className="flex-1 overflow-y-auto px-2 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-sm">Loading tests...</div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-red-500">
            <div className="text-sm text-center">
              <div className="font-medium">Error loading tests</div>
              <div className="text-xs mt-1">{error}</div>
            </div>
          </div>
        ) : (
          <TestList
            tests={tests}
            selectedTestId={selectedTestId}
            onSelect={handleSelectTest}
            searchQuery={searchQuery}
          />
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 p-2 flex-shrink-0">
        <p className="text-xs text-gray-400 text-center">chromedev-director</p>
      </div>
    </div>
  );
};

export default Sidebar;
