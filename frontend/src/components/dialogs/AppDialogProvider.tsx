import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type AlertOptions = {
  title: string;
  message: string;
  buttonLabel?: string;
};

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
};

type PromptOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  submitLabel?: string;
  cancelLabel?: string;
  required?: boolean;
  multiline?: boolean;
};

type DialogApi = {
  alert: (options: AlertOptions | string) => Promise<void>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
};

type AlertRequest = {
  type: 'alert';
  options: AlertOptions;
  resolve: () => void;
};

type ConfirmRequest = {
  type: 'confirm';
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
};

type PromptRequest = {
  type: 'prompt';
  options: PromptOptions;
  resolve: (value: string | null) => void;
};

type DialogRequest = AlertRequest | ConfirmRequest | PromptRequest;

const DialogContext = createContext<DialogApi | null>(null);

function normalizeAlertOptions(options: AlertOptions | string): AlertOptions {
  if (typeof options === 'string') {
    return { title: 'Hinweis', message: options };
  }
  return options;
}

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<DialogRequest | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const queueRef = useRef<DialogRequest[]>([]);

  const advanceQueue = useCallback(() => {
    const next = queueRef.current.shift() ?? null;
    setActive(next);
  }, []);

  const pushRequest = useCallback((request: DialogRequest) => {
    setActive((current) => {
      if (!current) {
        return request;
      }
      queueRef.current.push(request);
      return current;
    });
  }, []);

  const closeAlert = useCallback(() => {
    if (!active || active.type !== 'alert') return;
    active.resolve();
    advanceQueue();
  }, [active, advanceQueue]);

  const closeConfirm = useCallback(
    (confirmed: boolean) => {
      if (!active || active.type !== 'confirm') return;
      active.resolve(confirmed);
      advanceQueue();
    },
    [active, advanceQueue],
  );

  const closePrompt = useCallback(
    (submitted: boolean) => {
      if (!active || active.type !== 'prompt') return;
      if (submitted) {
        if (active.options.required && !promptValue.trim()) {
          return;
        }
        active.resolve(promptValue);
      } else {
        active.resolve(null);
      }
      advanceQueue();
    },
    [active, advanceQueue, promptValue],
  );

  useEffect(() => {
    if (active?.type === 'prompt') {
      setPromptValue(active.options.defaultValue ?? '');
      return;
    }
    setPromptValue('');
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (active.type === 'alert') {
          closeAlert();
          return;
        }
        if (active.type === 'confirm') {
          closeConfirm(false);
          return;
        }
        closePrompt(false);
        return;
      }
      if (event.key === 'Enter') {
        const target = event.target as HTMLElement | null;
        const isMultilineTextarea =
          active.type === 'prompt' && active.options.multiline && target?.tagName === 'TEXTAREA' && !event.ctrlKey && !event.metaKey;
        if (isMultilineTextarea) return;
        event.preventDefault();
        if (active.type === 'alert') {
          closeAlert();
          return;
        }
        if (active.type === 'confirm') {
          closeConfirm(true);
          return;
        }
        closePrompt(true);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
    };
  }, [active, closeAlert, closeConfirm, closePrompt]);

  const api = useMemo<DialogApi>(
    () => ({
      alert: (options: AlertOptions | string) =>
        new Promise<void>((resolve) => {
          pushRequest({
            type: 'alert',
            options: normalizeAlertOptions(options),
            resolve,
          });
        }),
      confirm: (options: ConfirmOptions) =>
        new Promise<boolean>((resolve) => {
          pushRequest({
            type: 'confirm',
            options,
            resolve,
          });
        }),
      prompt: (options: PromptOptions) =>
        new Promise<string | null>((resolve) => {
          pushRequest({
            type: 'prompt',
            options,
            resolve,
          });
        }),
    }),
    [pushRequest],
  );

  return (
    <DialogContext.Provider value={api}>
      {children}
      {active ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/55 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
            <h3 className="text-lg font-semibold text-slate-900">{active.options.title}</h3>
            {'message' in active.options && active.options.message ? (
              <p className="mt-2 text-sm text-slate-600">{active.options.message}</p>
            ) : null}

            {active.type === 'prompt' ? (
              <div className="mt-4">
                {active.options.multiline ? (
                  <textarea
                    className="field-input min-h-[110px] w-full"
                    value={promptValue}
                    onChange={(event) => setPromptValue(event.target.value)}
                    placeholder={active.options.placeholder}
                    autoFocus
                  />
                ) : (
                  <input
                    className="field-input w-full"
                    value={promptValue}
                    onChange={(event) => setPromptValue(event.target.value)}
                    placeholder={active.options.placeholder}
                    autoFocus
                  />
                )}
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {active.type === 'alert' ? (
                <button
                  type="button"
                  className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
                  onClick={closeAlert}
                >
                  {active.options.buttonLabel ?? 'OK'}
                </button>
              ) : null}

              {active.type === 'confirm' ? (
                <>
                  <button
                    type="button"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => closeConfirm(false)}
                  >
                    {active.options.cancelLabel ?? 'Abbrechen'}
                  </button>
                  <button
                    type="button"
                    className={`rounded-xl px-3 py-2 text-sm font-medium text-white ${
                      active.options.tone === 'danger'
                        ? 'bg-rose-600 hover:bg-rose-700'
                        : 'bg-brand-600 hover:bg-brand-700'
                    }`}
                    onClick={() => closeConfirm(true)}
                  >
                    {active.options.confirmLabel ?? 'Bestätigen'}
                  </button>
                </>
              ) : null}

              {active.type === 'prompt' ? (
                <>
                  <button
                    type="button"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => closePrompt(false)}
                  >
                    {active.options.cancelLabel ?? 'Abbrechen'}
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
                    onClick={() => closePrompt(true)}
                  >
                    {active.options.submitLabel ?? 'Speichern'}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </DialogContext.Provider>
  );
}

export function useAppDialog(): DialogApi {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useAppDialog must be used within AppDialogProvider');
  }
  return context;
}

