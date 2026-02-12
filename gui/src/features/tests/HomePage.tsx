import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTestStore } from '@/stores/test-store';

/**
 * HomePage component
 *
 * When tests exist, redirects to the first test.
 * When no tests exist, shows a simple empty state within the Layout.
 */
export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { tests, isLoading } = useTestStore((state) => ({
    tests: state.tests,
    isLoading: state.isLoading,
  }));

  // If tests exist, redirect to the first one
  useEffect(() => {
    if (!isLoading && tests.length > 0) {
      navigate(`/tests/${tests[0].id}`, { replace: true });
    }
  }, [tests, isLoading, navigate]);

  if (isLoading) {
    return null;
  }

  return (
    <div className="flex items-center justify-center h-full text-gray-500">
      <p className="text-sm">No tests saved yet. Use the MCP server to create tests.</p>
    </div>
  );
};

export default HomePage;
