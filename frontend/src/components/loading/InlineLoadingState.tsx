import { LoadingSpinner } from './LoadingSpinner';

type InlineLoadingStateProps = {
  message: string;
  className?: string;
};

export function InlineLoadingState({ message, className = '' }: InlineLoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800',
        'dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <LoadingSpinner className="text-sky-600 dark:text-sky-200" />
      <span>{message}</span>
    </div>
  );
}
