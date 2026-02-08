import React, { useEffect, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { FolderOpen } from 'lucide-react';
import { getChromeStatus, getHealth, switchProject } from '@/lib/api';
import { useTestStore } from '@/stores/test-store';
import { useNavigate } from 'react-router-dom';

/**
 * AppBar component
 *
 * Displays:
 * - Logo/title on the left
 * - Chrome connection status indicator (green/red dot) on the right
 * - Menu button to toggle sidebar on mobile
 *
 * Features:
 * - Polls Chrome status every 3-5 seconds
 * - Shows "Connected" or "Offline" with color-coded indicator
 * - Responsive design: menu button on mobile, sidebar always visible on desktop
 * - Clickable project path to switch projects
 */
export const AppBar: React.FC = () => {
  const { toggleSidebar } = useUIStore();
  const navigate = useNavigate();
  const [chromeStatus, setChromeStatus] = useState<{
    connected: boolean;
    version?: string;
  } | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [projectRoot, setProjectRoot] = useState<string | null>(null);

  // Inline edit state
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch project root once on mount
  useEffect(() => {
    getHealth()
      .then((health) => setProjectRoot(health.projectRoot))
      .catch(() => {});
  }, []);

  // Poll Chrome status every 4 seconds
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        setIsLoadingStatus(true);
        const status = await getChromeStatus();
        setChromeStatus(status);
      } catch (error) {
        // If status fails to load, mark as offline
        setChromeStatus({ connected: false });
      } finally {
        setIsLoadingStatus(false);
      }
    };

    // Fetch immediately on mount
    fetchStatus();

    // Set up polling interval (4 seconds)
    const interval = setInterval(fetchStatus, 4000);

    return () => clearInterval(interval);
  }, []);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const startEditing = () => {
    setInputValue(projectRoot ?? '');
    setEditError(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditError(null);
  };

  const submitSwitch = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setEditError('Path cannot be empty');
      return;
    }
    if (trimmed === projectRoot) {
      cancelEditing();
      return;
    }

    setIsSwitching(true);
    setEditError(null);
    try {
      const result = await switchProject(trimmed);
      setProjectRoot(result.projectRoot);
      setIsEditing(false);
      // Reload test list and navigate home
      await useTestStore.getState().fetchTests();
      navigate('/');
    } catch (err: any) {
      const msg = err?.data?.error ?? err?.message ?? 'Failed to switch project';
      setEditError(msg);
    } finally {
      setIsSwitching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitSwitch();
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
  };

  const isConnected = chromeStatus?.connected ?? false;

  return (
    <header className="bg-white border-b border-gray-200 shadow-sm">
      <div className="h-16 px-4 flex items-center justify-between">
        {/* Left side: Logo + Menu button */}
        <div className="flex items-center gap-3">
          <button
            onClick={toggleSidebar}
            className="md:hidden p-2 rounded-md text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Toggle sidebar"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="text-xl font-bold text-gray-900">
              chromedev-director
            </div>
            {isEditing ? (
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-white border border-blue-400 ring-2 ring-blue-100">
                  <FolderOpen size={14} className="text-blue-500 flex-shrink-0" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={() => {
                      // Delay to allow click events to fire
                      setTimeout(() => {
                        if (!isSwitching) cancelEditing();
                      }, 150);
                    }}
                    disabled={isSwitching}
                    className="text-xs font-mono text-gray-800 bg-transparent outline-none min-w-[200px] max-w-md"
                    placeholder="/path/to/project"
                  />
                </div>
                {editError && (
                  <span className="text-xs text-red-600 mt-0.5 ml-1">{editError}</span>
                )}
              </div>
            ) : projectRoot ? (
              <button
                onClick={startEditing}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-gray-100 border border-gray-200 hover:bg-gray-200 hover:border-gray-300 transition-colors cursor-pointer"
                title="Click to switch project"
              >
                <FolderOpen size={14} className="text-gray-500 flex-shrink-0" />
                <span className="text-xs font-mono text-gray-600 truncate max-w-xs">
                  {projectRoot}
                </span>
              </button>
            ) : null}
          </div>
        </div>

        {/* Right side: Chrome status indicator */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-gray-50 border border-gray-200">
            {/* Status indicator dot */}
            <div
              className={`w-2 h-2 rounded-full transition-colors ${
                isConnected ? 'bg-green-500' : 'bg-red-500'
              }`}
              title={isConnected ? 'Chrome connected' : 'Chrome offline'}
            />

            {/* Status text */}
            <span className="text-sm font-medium text-gray-700">
              {isLoadingStatus ? (
                <span className="text-gray-500">Checking...</span>
              ) : isConnected ? (
                'Connected'
              ) : (
                'Offline'
              )}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};

export default AppBar;
