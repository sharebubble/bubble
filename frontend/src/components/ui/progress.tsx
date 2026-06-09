import {
  Progress as MantineProgress,
  type ProgressProps as MantineProgressProps,
} from '@mantine/core';
import React from 'react';

interface ProgressProps extends Omit<MantineProgressProps, 'value'> {
  value?: number;
  className?: string;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ value = 0, className, ...props }, ref) => (
    <MantineProgress ref={ref} value={value} className={className} {...props} />
  ),
);
Progress.displayName = 'Progress';

export { Progress };
