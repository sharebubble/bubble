import { Switch as MantineSwitch, type SwitchProps as MantineSwitchProps } from '@mantine/core';
import React from 'react';

interface SwitchProps extends Omit<MantineSwitchProps, 'checked' | 'onChange'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ checked, onCheckedChange, className, ...props }, ref) => (
    <MantineSwitch
      ref={ref}
      checked={checked}
      onChange={e => onCheckedChange?.(e.currentTarget.checked)}
      className={className}
      {...props}
    />
  ),
);
Switch.displayName = 'Switch';

export { Switch };
