import React, { useMemo } from 'react';
import type { SavedTest } from '@/lib/types';
import TestListItem from './TestListItem';

export interface TestListProps {
  tests: SavedTest[];
  selectedTestId?: string | null;
  onSelect: (test: SavedTest) => void;
  searchQuery: string;
}

/**
 * Filter tests by search query (case-insensitive matching on name and description)
 */
function filterTests(tests: SavedTest[], query: string): SavedTest[] {
  if (!query.trim()) {
    return tests;
  }

  const lowerQuery = query.toLowerCase();
  return tests.filter((test) => {
    const nameMatch = test.name.toLowerCase().includes(lowerQuery);
    const descMatch = test.description?.toLowerCase().includes(lowerQuery);
    const tagsMatch = test.tags?.some((tag) =>
      tag.toLowerCase().includes(lowerQuery)
    );
    return nameMatch || descMatch || tagsMatch;
  });
}

/**
 * TestList component
 * Displays a scrollable list of tests filtered by search query
 * Shows pass/fail status icons and step counts for each test
 */
export const TestList: React.FC<TestListProps> = ({
  tests,
  selectedTestId,
  searchQuery,
}) => {
  // Filter and sort tests (newest updated first)
  const filteredTests = useMemo(
    () => filterTests(tests, searchQuery).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    ),
    [tests, searchQuery]
  );

  return (
    <div className="h-full flex-1 rounded-md border overflow-y-auto">
      <div className="p-4 space-y-2">
        {filteredTests.length === 0 ? (
          <div className="text-center text-sm text-gray-500 py-8">
            {tests.length === 0
              ? 'No tests saved yet'
              : 'No tests match your search'}
          </div>
        ) : (
          filteredTests.map((test) => (
            <TestListItem
              key={test.id}
              test={test}
              isSelected={selectedTestId === test.id}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default TestList;
