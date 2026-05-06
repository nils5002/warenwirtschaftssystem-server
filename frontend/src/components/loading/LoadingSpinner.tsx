type LoadingSpinnerProps = {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
};

const sizeMap: Record<NonNullable<LoadingSpinnerProps['size']>, string> = {
  sm: 'h-3.5 w-3.5 border-2',
  md: 'h-4 w-4 border-2',
  lg: 'h-6 w-6 border-[3px]',
};

export function LoadingSpinner({ className = '', size = 'md' }: LoadingSpinnerProps) {
  return (
    <span
      aria-hidden="true"
      className={[
        'inline-block animate-spin rounded-full border-slate-300 border-t-current text-current',
        sizeMap[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
