import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoadingSpinner } from './LoadingSpinner';

type LoadingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isLoading?: boolean;
  loadingText?: string;
  children: ReactNode;
  spinnerSize?: 'sm' | 'md' | 'lg';
};

export const LoadingButton = forwardRef<HTMLButtonElement, LoadingButtonProps>(
  function LoadingButton(
    {
      isLoading = false,
      loadingText,
      children,
      disabled,
      spinnerSize = 'sm',
      className,
      ...buttonProps
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        {...buttonProps}
        className={className}
        disabled={disabled || isLoading}
        aria-busy={isLoading}
      >
        {isLoading ? <LoadingSpinner size={spinnerSize} /> : null}
        {isLoading && loadingText ? loadingText : children}
      </button>
    );
  },
);
