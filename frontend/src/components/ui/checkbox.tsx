import {
  Checkbox as MantineCheckbox,
  type CheckboxProps as MantineCheckboxProps,
} from '@mantine/core';
import React from 'react';

interface CheckboxProps extends Omit<MantineCheckboxProps, 'checked' | 'onChange'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ checked, onCheckedChange, className, ...props }, ref) => (
    <MantineCheckbox
      ref={ref}
      checked={checked}
      onChange={e => onCheckedChange?.(e.currentTarget.checked)}
      className={className}
      {...props}
    />
  ),
);
Checkbox.displayName = 'Checkbox';

export { Checkbox };
