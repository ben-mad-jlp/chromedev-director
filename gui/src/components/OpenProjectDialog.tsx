import React, { Fragment, useState, useEffect, useRef } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { switchProject, getHealth } from '@/lib/api';
import { useTestStore } from '@/stores/test-store';
import { useNavigate } from 'react-router-dom';

export interface OpenProjectDialogProps {
  open: boolean;
  onClose: () => void;
}

export const OpenProjectDialog: React.FC<OpenProjectDialogProps> = ({
  open,
  onClose,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Load current project path when dialog opens
  useEffect(() => {
    if (open) {
      setError(null);
      setIsSwitching(false);
      getHealth()
        .then((health) => setInputValue(health.projectRoot))
        .catch(() => setInputValue(''));
    }
  }, [open]);

  // Focus input after value is loaded
  useEffect(() => {
    if (open && inputValue && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [open, inputValue]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setError('Path cannot be empty');
      return;
    }

    setIsSwitching(true);
    setError(null);
    try {
      await switchProject(trimmed);
      await useTestStore.getState().fetchTests();
      onClose();
      navigate('/');
    } catch (err: any) {
      const msg = err?.data?.error ?? err?.message ?? 'Failed to switch project';
      setError(msg);
    } finally {
      setIsSwitching(false);
    }
  };

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/30" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
                <Dialog.Title className="text-lg font-semibold text-gray-900">
                  Open Project
                </Dialog.Title>
                <p className="mt-1 text-sm text-gray-500">
                  Enter the absolute path to a project folder.
                </p>

                <form onSubmit={handleSubmit} className="mt-4">
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    disabled={isSwitching}
                    placeholder="/path/to/project"
                    className={`block w-full rounded-md border px-3 py-2 text-sm font-mono shadow-sm focus:outline-none focus:ring-1 ${
                      error
                        ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                        : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
                    }`}
                  />
                  {error && (
                    <p className="mt-1 text-xs text-red-600">{error}</p>
                  )}

                  <div className="flex justify-end gap-3 mt-4">
                    <button
                      type="button"
                      onClick={onClose}
                      disabled={isSwitching}
                      className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSwitching}
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
                    >
                      {isSwitching ? 'Switching...' : 'Open'}
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

export default OpenProjectDialog;
