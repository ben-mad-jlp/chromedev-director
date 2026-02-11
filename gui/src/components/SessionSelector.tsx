import React, { useState, useEffect, Fragment } from 'react';
import { Listbox, Transition } from '@headlessui/react';
import { Chrome, ChevronDown, Plus, Trash2, RefreshCw } from 'lucide-react';
import { useSessionStore } from '@/stores/session-store';
import RegisterSessionDialog from './RegisterSessionDialog';

export interface SessionSelectorProps {
  disabled?: boolean;
  className?: string;
}

/**
 * SessionSelector - Dropdown to select/manage Chrome sessions
 *
 * Features:
 * - Lists registered sessions with last used time
 * - Shows "No Session" placeholder when none selected
 * - "Register New Session" button in dropdown footer
 * - Delete session button (trash icon)
 * - Persists selection via session-store
 */
export const SessionSelector: React.FC<SessionSelectorProps> = ({
  disabled = false,
  className = '',
}) => {
  const { sessions = [], selectedSessionId, isLoading, selectSession, fetchSessions, deleteSession } =
    useSessionStore((state) => ({
      sessions: state.sessions ?? [],
      selectedSessionId: state.selectedSessionId,
      isLoading: state.isLoading,
      selectSession: state.selectSession,
      fetchSessions: state.fetchSessions,
      deleteSession: state.deleteSession,
    }));
  const [isRegisterDialogOpen, setIsRegisterDialogOpen] = useState(false);

  // Fetch sessions on mount
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const selectedSession = sessions.find(s => s.sessionId === selectedSessionId);

  const handleDelete = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete session "${sessionId}"?`)) {
      try {
        await deleteSession(sessionId);
      } catch (error) {
        console.error('Failed to delete session:', error);
      }
    }
  };

  const formatLastUsed = (isoDate: string) => {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <>
      <div className={`relative ${className}`}>
        <Listbox value={selectedSessionId} onChange={selectSession} disabled={disabled || isLoading}>
          <div className="relative">
            <Listbox.Button className="relative w-full cursor-default rounded-lg bg-white py-2 pl-3 pr-10 text-left border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed">
              <span className="flex items-center gap-2 truncate">
                <Chrome className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-900">
                  {selectedSession ? selectedSession.sessionId : 'No Session'}
                </span>
              </span>
              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden="true" />
              </span>
            </Listbox.Button>

            <Transition
              as={Fragment}
              leave="transition ease-in duration-100"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <Listbox.Options className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
                {/* No session option */}
                <Listbox.Option
                  value={null}
                  className={({ active }) =>
                    `relative cursor-default select-none py-2 pl-10 pr-4 ${
                      active ? 'bg-blue-100' : ''
                    }`
                  }
                >
                  {({ selected }) => (
                    <span className={`block truncate text-gray-900 ${selected ? 'font-medium' : 'font-normal'}`}>
                      No Session
                    </span>
                  )}
                </Listbox.Option>

                {/* Session list */}
                {sessions.map((session) => (
                  <Listbox.Option
                    key={session.sessionId}
                    value={session.sessionId}
                    className={({ active }) =>
                      `relative cursor-default select-none py-2 pl-10 pr-4 ${
                        active ? 'bg-blue-100' : ''
                      }`
                    }
                  >
                    {({ selected }) => (
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <span className={`block truncate text-gray-900 ${selected ? 'font-medium' : 'font-normal'}`}>
                            {session.sessionId}
                          </span>
                          <span className="text-xs text-gray-500">
                            {formatLastUsed(session.lastUsed)}
                          </span>
                        </div>
                        <button
                          onClick={(e) => handleDelete(session.sessionId, e)}
                          className="ml-2 p-1 hover:bg-red-100 rounded"
                          title="Delete session"
                        >
                          <Trash2 className="h-3 w-3 text-red-600" />
                        </button>
                      </div>
                    )}
                  </Listbox.Option>
                ))}

                {/* Footer: Register new session */}
                <div className="border-t border-gray-200 mt-1 pt-1">
                  <button
                    onClick={() => setIsRegisterDialogOpen(true)}
                    className="w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Register New Session
                  </button>
                </div>
              </Listbox.Options>
            </Transition>
          </div>
        </Listbox>
      </div>

      {/* Register Session Dialog */}
      <RegisterSessionDialog
        open={isRegisterDialogOpen}
        onClose={() => setIsRegisterDialogOpen(false)}
        onSuccess={(sessionId) => {
          setIsRegisterDialogOpen(false);
          selectSession(sessionId);
        }}
      />
    </>
  );
};

export default SessionSelector;
