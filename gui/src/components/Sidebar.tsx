import React, { useEffect, useState } from 'react';
import { Search, FolderOpen, RefreshCw } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useTestStore } from '@/stores/test-store';
import TestList from '@/features/tests/TestList';
import OpenProjectDialog from './OpenProjectDialog';

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
 * - Uses test-store for tests (stays in sync after rename/delete)
 * - Search filtering on test name, description, and tags
 * - Loading and error states
 */
export const Sidebar: React.FC = () => {
  const { searchQuery, setSearchQuery } = useUIStore();
  const { tests, isLoading, error, fetchTests, selectedTestId, selectTest } = useTestStore();
  const [showOpenProject, setShowOpenProject] = useState(false);

  // Fetch tests on mount
  useEffect(() => {
    fetchTests();
  }, [fetchTests]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  return (
    <div className="w-full h-full flex flex-col bg-white">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex-shrink-0">
        {/* Search + Refresh */}
        <div className="relative flex items-center gap-2">
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
          <button
            onClick={() => fetchTests()}
            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors flex-shrink-0"
            title="Refresh tests from disk"
          >
            <RefreshCw size={16} />
          </button>
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
            onSelect={(test) => selectTest(test.id)}
            searchQuery={searchQuery}
          />
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 p-2 flex-shrink-0">
        <button
          onClick={() => setShowOpenProject(true)}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
        >
          <FolderOpen size={16} className="text-gray-400" />
          Open Project...
        </button>
      </div>

      <OpenProjectDialog
        open={showOpenProject}
        onClose={() => setShowOpenProject(false)}
      />
    </div>
  );
};

export default Sidebar;
