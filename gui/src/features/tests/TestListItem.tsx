import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { SavedTest } from '@/lib/types';

export interface TestListItemProps {
  test: SavedTest;
  isSelected: boolean;
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
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
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-medium text-sm break-words">{test.name}</h3>
          <span className="text-xs text-gray-500 flex-shrink-0" title={new Date(test.updatedAt).toLocaleString()}>
            {formatRelativeTime(test.updatedAt)}
          </span>
        </div>
        <p className="text-xs text-gray-500 font-mono break-all">{test.id}</p>
        {test.description && (
          <p className="text-xs text-gray-500 break-words">
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
