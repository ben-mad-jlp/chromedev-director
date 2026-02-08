import React, { useState, useEffect, Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import type { InputDef } from '@/lib/types';

export interface RunInputsDialogProps {
  open: boolean;
  inputs: InputDef[];
  onSubmit: (values: Record<string, unknown>) => void;
  onClose: () => void;
}

/**
 * Dialog that prompts the user for runtime test inputs before execution.
 * Renders form controls based on InputDef.type, pre-fills defaults,
 * validates required fields, and coerces types on submit.
 */
export const RunInputsDialog: React.FC<RunInputsDialogProps> = ({
  open,
  inputs,
  onSubmit,
  onClose,
}) => {
  // Form state: keyed by input name
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      const initial: Record<string, string | boolean> = {};
      for (const input of inputs) {
        if (input.type === 'boolean') {
          initial[input.name] = input.default === true;
        } else {
          initial[input.name] = input.default !== undefined ? String(input.default) : '';
        }
      }
      setValues(initial);
      setErrors({});
    }
  }, [open, inputs]);

  const handleChange = (name: string, value: string | boolean) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    // Clear error on change
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields
    const newErrors: Record<string, string> = {};
    for (const input of inputs) {
      const isRequired = input.required !== false;
      if (isRequired && input.type !== 'boolean') {
        const val = values[input.name];
        if (val === undefined || val === '') {
          newErrors[input.name] = `${input.label} is required`;
        }
      }
      // Validate number type
      if (input.type === 'number' && values[input.name] !== '' && values[input.name] !== undefined) {
        const num = Number(values[input.name]);
        if (isNaN(num)) {
          newErrors[input.name] = `${input.label} must be a number`;
        }
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Coerce types
    const coerced: Record<string, unknown> = {};
    for (const input of inputs) {
      const raw = values[input.name];
      if (input.type === 'number') {
        coerced[input.name] = raw === '' ? undefined : parseFloat(raw as string);
      } else if (input.type === 'boolean') {
        coerced[input.name] = raw === true;
      } else {
        coerced[input.name] = raw;
      }
    }

    onSubmit(coerced);
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
              <Dialog.Panel className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
                <Dialog.Title className="text-lg font-semibold text-gray-900">
                  Test Inputs
                </Dialog.Title>
                <p className="mt-1 text-sm text-gray-500">
                  Provide values for this test run.
                </p>

                <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                  {inputs.map((input) => (
                    <div key={input.name}>
                      {input.type === 'boolean' ? (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={values[input.name] === true}
                            onChange={(e) => handleChange(input.name, e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm font-medium text-gray-700">
                            {input.label}
                          </span>
                        </label>
                      ) : (
                        <>
                          <label
                            htmlFor={`input-${input.name}`}
                            className="block text-sm font-medium text-gray-700"
                          >
                            {input.label}
                            {input.required !== false && (
                              <span className="text-red-500 ml-0.5">*</span>
                            )}
                          </label>
                          <input
                            id={`input-${input.name}`}
                            type={input.type === 'number' ? 'number' : 'text'}
                            value={(values[input.name] as string) ?? ''}
                            onChange={(e) => handleChange(input.name, e.target.value)}
                            step={input.type === 'number' ? 'any' : undefined}
                            className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
                              errors[input.name]
                                ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                                : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
                            }`}
                          />
                        </>
                      )}
                      {errors[input.name] && (
                        <p className="mt-1 text-xs text-red-600">{errors[input.name]}</p>
                      )}
                    </div>
                  ))}

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    >
                      Run
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

export default RunInputsDialog;
