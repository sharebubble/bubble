import { TextInput, type TextInputProps } from '@mantine/core';
import React from 'react';

// Compatibility wrapper: exposes the same interface as the old Shadcn Input
// but renders Mantine's TextInput underneath.
// When `label` is not provided we hide the Mantine label wrapper so the
// component can still be used as a bare <input> replacement.

interface InputProps extends Omit<TextInputProps, 'size'> {
  className?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <TextInput
    ref={ref}
    classNames={{ input: className }}
    // Remove the top-level wrapper padding when used without a label so it
    // behaves like a plain <input> (matching the old Shadcn component).
    styles={!props.label ? { root: { margin: 0 } } : undefined}
    {...props}
  />
));
Input.displayName = 'Input';

export { Input };
export type { InputProps };
