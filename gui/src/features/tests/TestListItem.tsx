import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { SavedTest } from '@/lib/types';

export interface TestListItemProps {
  test: SavedTest;
  isSelected: boolean;
}

/**
 * TestListItem component
 * Displays a single test in the sidebar list with name, status icon, and step count
 * Navigates to test detail view on click
 */
export const TestListItem: React.FC<TestListItemProps> = ({
  test,
  isSelected,
}) => {
  const navigate = useNavigate();
  const stepCount = test.definition.steps.length;

  const handleClick = () => {
    navigate(`/tests/${test.id}`);
  };

  return (
    <button
      onClick={handleClick}
      className={`w-full text-left px-3 py-2.5 rounded-md transition-colors ${
        isSelected
          ? 'bg-blue-50'
          : 'hover:bg-gray-50'
      }`}
    >
      <div className="min-w-0">
        <h3 className="font-medium text-sm truncate">{test.name}</h3>
        {test.description && (
          <p className="text-xs text-gray-500 truncate">
            {test.description}
          </p>
        )}
        <div className="flex gap-1 mt-1">
          <span className="inline-block px-2 py-1 text-xs border border-gray-300 rounded bg-white">
            {stepCount} step{stepCount !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </button>
  );
};

export default TestListItem;
