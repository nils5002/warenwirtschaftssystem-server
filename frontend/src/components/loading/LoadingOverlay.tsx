import type { ReactNode } from 'react';
import { LoadingSpinner } from './LoadingSpinner';

type LoadingOverlayProps = {
  show: boolean;
  message: string;
  children?: ReactNode;
  fullScreen?: boolean;
};

export function LoadingOverlay({
  show,
  message,
  children,
  fullScreen = false,
}: LoadingOverlayProps) {
  if (!show) return <>{children}</>;

  if (fullScreen) {
    return (
      <>
        {children}
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/55 px-4">
          <div
            role="status"
            aria-live="assertive"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-700 shadow-panel dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <div className="flex items-center gap-3">
              <LoadingSpinner size="lg" className="text-brand-600 dark:text-sky-300" />
              <p>{message}</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="relative">
      {children}
      <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-white/70 px-4 backdrop-blur-sm dark:bg-slate-900/70">
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <LoadingSpinner className="text-brand-600 dark:text-sky-300" />
          <p>{message}</p>
        </div>
      </div>
    </div>
  );
}
