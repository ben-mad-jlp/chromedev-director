import React, { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from '@/components/Layout';
import HomePage from '@/features/tests/HomePage';
import TestDetail from '@/features/tests/TestDetail';
import { useTestStore } from '@/stores/test-store';
import { useRunStore } from '@/stores/run-store';
import { useUIStore } from '@/stores/ui-store';
import { connectWebSocket, subscribeToWebSocket } from '@/lib/ws';
import { getChromeStatus } from '@/lib/api';

/**
 * App Component - Main application with routing and initialization
 *
 * Initialization sequence on mount:
 * 1. Connect to WebSocket server
 * 2. Subscribe to run:start, run:step, run:complete, console, network messages
 * 3. Fetch initial list of tests
 * 4. Start Chrome status polling (4s interval)
 *
 * Routes:
 * - / → HomePage (shows empty state or test list)
 * - /tests/:testId → TestDetail (shows test details with results/history tabs)
 */
const App: React.FC = () => {
  const fetchTests = useTestStore((state) => state.fetchTests);
  const handleWsMessage = useRunStore((state) => state.handleWsMessage);

  useEffect(() => {
    let pollingInterval: number | null = null;
    const unsubscribers: Array<() => void> = [];

    const initialize = async () => {
      try {
        // 1. Connect to WebSocket
        console.log('[App] Connecting to WebSocket...');
        await connectWebSocket();
        console.log('[App] WebSocket connected');

        // 2. Subscribe to WebSocket messages
        const unsubscribe1 = subscribeToWebSocket('run:start', (data) => {
          handleWsMessage({ type: 'run:start', testId: data.testId, runId: data.runId });
        });
        unsubscribers.push(unsubscribe1);

        const unsubscribe2 = subscribeToWebSocket('run:step', (data) => {
          handleWsMessage({
            type: 'run:step',
            testId: data.testId,
            runId: data.runId,
            stepIndex: data.stepIndex,
            stepLabel: data.stepLabel,
            status: data.status,
            duration_ms: data.duration_ms,
            error: data.error,
          });
        });
        unsubscribers.push(unsubscribe2);

        const unsubscribe3 = subscribeToWebSocket('run:complete', (data) => {
          handleWsMessage({
            type: 'run:complete',
            testId: data.testId,
            runId: data.runId,
            status: data.status,
          });
        });
        unsubscribers.push(unsubscribe3);

        const unsubscribe4 = subscribeToWebSocket('console', (data) => {
          handleWsMessage({
            type: 'console',
            testId: data.testId,
            runId: data.runId,
            level: data.level,
            text: data.text,
          });
        });
        unsubscribers.push(unsubscribe4);

        const unsubscribe5 = subscribeToWebSocket('network', (data) => {
          handleWsMessage({
            type: 'network',
            testId: data.testId,
            runId: data.runId,
            method: data.method,
            url: data.url,
            status: data.status,
            duration_ms: data.duration_ms,
          });
        });
        unsubscribers.push(unsubscribe5);

        // 3. Fetch initial test list
        console.log('[App] Fetching tests...');
        await fetchTests();
        console.log('[App] Tests loaded');
      } catch (error) {
        console.error('[App] Initialization error:', error);
        // Continue even if WebSocket or fetch fails - show graceful degradation
      }

      // 4. Start Chrome status polling (4 second interval)
      const pollChromeStatus = async () => {
        try {
          const status = await getChromeStatus();
          useUIStore.setState({ chromeConnected: status.connected });
        } catch (error) {
          console.warn('[App] Chrome status check failed:', error);
          useUIStore.setState({ chromeConnected: false });
        }
      };

      // Initial check
      await pollChromeStatus();

      // Set up polling interval
      pollingInterval = window.setInterval(pollChromeStatus, 4000);
    };

    // Start initialization
    initialize();

    // Cleanup on unmount
    return () => {
      // Clear polling interval
      if (pollingInterval !== null) {
        clearInterval(pollingInterval);
      }

      // Unsubscribe from WebSocket messages
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [fetchTests, handleWsMessage]);

  return (
    <Layout>
      <Routes>
        {/* Empty state when no test selected */}
        <Route path="/" element={<HomePage />} />

        {/* Test detail */}
        <Route path="/tests/:testId" element={<TestDetail />} />
      </Routes>
    </Layout>
  );
};

export default App;
