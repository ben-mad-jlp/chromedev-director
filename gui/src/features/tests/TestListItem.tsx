import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { SavedTest } from '@/lib/types';

export interface TestListItemProps {
  test: SavedTest;
  isSelected: boolean;
}

/**
 * Determine the status icon and color based on the test's last run result
 */
function getStatusIcon(_test: SavedTest): { icon: string; color: string; label: string } {
  // For now, we return a neutral state since last run result is not included in SavedTest
  // In the future, this could be enhanced to accept a lastResult prop
  return {
    icon: '–',
    color: 'text-gray-400',
    label: 'No runs',
  };
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
  const status = getStatusIcon(test);
  const stepCount = test.definition.steps.length;

  const handleClick = () => {
    navigate(`/tests/${test.id}`);
  };

  return (
    <button
      onClick={handleClick}
      className={`w-full text-left px-4 py-3 rounded-md transition-colors border-l-4 ${
        isSelected
          ? 'bg-blue-50 border-l-blue-500'
          : 'border-l-transparent hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Status icon */}
        <span className={`text-lg font-semibold flex-shrink-0 ${status.color}`}>
          {status.icon}
        </span>

        {/* Test name and details */}
        <div className="flex-grow min-w-0">
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
      </div>
    </button>
  );
};

export default TestListItem;
