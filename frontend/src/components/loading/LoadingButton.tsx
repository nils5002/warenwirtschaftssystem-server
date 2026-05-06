import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { LoadingSpinner } from './LoadingSpinner';

type LoadingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isLoading?: boolean;
  loadingText?: string;
  children: ReactNode;
  spinnerSize?: 'sm' | 'md' | 'lg';
};

export function LoadingButton({
  isLoading = false,
  loadingText,
  children,
  disabled,
  spinnerSize = 'sm',
  className,
  ...buttonProps
}: LoadingButtonProps) {
  return (
    <button
      {...buttonProps}
      className={className}
      disabled={disabled || isLoading}
      aria-busy={isLoading}
    >
      {isLoading ? <LoadingSpinner size={spinnerSize} /> : null}
      {isLoading && loadingText ? loadingText : children}
    </button>
  );
}
