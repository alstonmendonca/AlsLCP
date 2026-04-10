import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-[#0f766e] text-white hover:bg-[#115e59] focus-visible:ring-[#0f766e]',
        secondary: 'bg-white text-[#0f172a] border border-[#cbd5e1] hover:bg-[#f8fafc] focus-visible:ring-[#64748b]',
        ghost: 'text-[#0f172a] hover:bg-[#e2e8f0] focus-visible:ring-[#64748b]',
      },
      size: {
        default: 'h-10 px-4 py-2',
        lg: 'h-12 px-6 text-base',
        sm: 'h-9 px-3',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

const Button = React.forwardRef(({ className, variant, size, ...props }, ref) => {
  return <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});

Button.displayName = 'Button';

export { Button, buttonVariants };
