import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Plus, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTestStore } from '@/stores/test-store';

/**
 * HomePage component
 *
 * Displays the home/landing page with:
 * - Welcome message when no tests are saved
 * - Empty state with call-to-action to create first test
 * - Links to documentation
 * - If tests exist, redirects to first test
 *
 * Features:
 * - Loads tests from store on mount
 * - Redirects if tests already exist
 * - Responsive empty state design
 * - Quick action buttons for documentation and test creation
 */
export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { tests, fetchTests, isLoading } = useTestStore((state) => ({
    tests: state.tests,
    fetchTests: state.fetchTests,
    isLoading: state.isLoading,
  }));

  // Fetch tests on mount
  useEffect(() => {
    fetchTests().catch(() => {
      // Silently fail - we'll show empty state
    });
  }, [fetchTests]);

  // If tests exist, redirect to the first one
  useEffect(() => {
    if (!isLoading && tests.length > 0) {
      navigate(`/tests/${tests[0].id}`, { replace: true });
    }
  }, [tests, isLoading, navigate]);

  const handleCreateTest = () => {
    // Navigate to test creation flow (could be a modal or a separate page)
    // For now, this is a placeholder - actual creation flow will be implemented later
    console.log('Create test action');
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="w-full max-w-md px-6">
        <div className="text-center space-y-8">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
              <Zap className="w-8 h-8 text-blue-600" />
            </div>
          </div>

          {/* Heading */}
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-gray-900">
              Welcome to chromedev-director
            </h1>
            <p className="text-lg text-gray-600">
              Automated browser testing with Chrome DevTools Protocol
            </p>
          </div>

          {/* Description */}
          <div className="space-y-4 text-center">
            <p className="text-gray-600 text-base leading-relaxed">
              Create, organize, and run automated tests for your web applications.
              Define test steps visually and get instant feedback on execution.
            </p>
          </div>

          {/* Call-to-action section */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">
              Get Started
            </h2>

            <Button
              onClick={handleCreateTest}
              size="lg"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Create Your First Test
            </Button>

            <p className="text-sm text-gray-500 py-2">or</p>

            <Button
              variant="outline"
              size="lg"
              className="w-full flex items-center justify-center gap-2"
              onClick={() => {
                // Open documentation (external link or in-app guide)
                window.open('https://docs.example.com', '_blank');
              }}
            >
              <BookOpen className="w-5 h-5" />
              View Documentation
            </Button>
          </div>

          {/* Features list */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3 text-left">
            <h3 className="font-semibold text-gray-900">Features</h3>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-3">
                <span className="text-blue-600 font-bold mt-0.5">✓</span>
                <span>Point-and-click step creation with full TypeScript support</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-blue-600 font-bold mt-0.5">✓</span>
                <span>Live test execution with step-by-step progress tracking</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-blue-600 font-bold mt-0.5">✓</span>
                <span>Network mocking and assertion capabilities</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-blue-600 font-bold mt-0.5">✓</span>
                <span>Full test run history and result analysis</span>
              </li>
            </ul>
          </div>

          {/* Footer text */}
          <div className="text-xs text-gray-500 space-y-1">
            <p>No tests saved yet. Create one to get started.</p>
            <p>Your tests are stored locally and can be exported anytime.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HomePage;
