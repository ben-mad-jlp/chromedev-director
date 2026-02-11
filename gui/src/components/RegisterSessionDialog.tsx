import React, { useState, Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Chrome, X, Loader2 } from 'lucide-react';
import { useSessionStore } from '@/stores/session-store';

export interface RegisterSessionDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (sessionId: string) => void;
}

/**
 * RegisterSessionDialog - Modal for registering new Chrome sessions
 *
 * Features:
 * - Input field for session ID with validation
 * - Auto-generate suggestion: session-{timestamp}
 * - Calls api.registerSession() via session-store
 * - Shows loading state during registration
 * - Error handling with inline error message
 */
export const RegisterSessionDialog: React.FC<RegisterSessionDialogProps> = ({
  open,
  onClose,
  onSuccess,
}) => {
  const { registerSession, isLoading } = useSessionStore((state) => ({
    registerSession: state.registerSession,
    isLoading: state.isLoading,
  }));
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!sessionId.trim()) {
      setError('Session ID is required');
      return;
    }

    if (!/^[a-z0-9-_]+$/i.test(sessionId)) {
      setError('Session ID must contain only letters, numbers, hyphens, and underscores');
      return;
    }

    try {
      await registerSession(sessionId);
      setSessionId('');
      onSuccess?.(sessionId);
    } catch (error: any) {
      setError(error.message);
    }
  };

  const handleGenerateId = () => {
    setSessionId(`session-${Date.now()}`);
  };

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        {/* Dialog content */}
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-lg bg-white p-6 text-left align-middle shadow-xl transition-all">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <Dialog.Title className="text-lg font-medium text-gray-900 flex items-center gap-2">
                    <Chrome className="h-5 w-5 text-blue-600" />
                    Register Chrome Session
                  </Dialog.Title>
                  <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {/* Description */}
                <p className="text-sm text-gray-600 mb-4">
                  Create a dedicated Chrome tab for your testing session. All tests using this session
                  will reuse the same tab.
                </p>

                {/* Form */}
                <form onSubmit={handleSubmit}>
                  <div className="mb-4">
                    <label
                      htmlFor="sessionId"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      Session ID
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="sessionId"
                        type="text"
                        value={sessionId}
                        onChange={(e) => setSessionId(e.target.value)}
                        placeholder="my-session"
                        className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={isLoading}
                      />
                      <button
                        type="button"
                        onClick={handleGenerateId}
                        className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md text-gray-900"
                        disabled={isLoading}
                      >
                        Generate
                      </button>
                    </div>
                    {error && (
                      <p className="mt-1 text-sm text-red-600">{error}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md text-gray-900"
                      disabled={isLoading}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      disabled={isLoading || !sessionId.trim()}
                    >
                      {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                      Register
                    </button>
                  </div>
                </form>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};

export default RegisterSessionDialog;
