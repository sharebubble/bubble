import { InputLabel, type InputLabelProps } from '@mantine/core';
import React from 'react';

interface LabelProps extends InputLabelProps {
  className?: string;
}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, children, ...props }, ref) => (
    <InputLabel ref={ref} className={className} {...props}>
      {children}
    </InputLabel>
  ),
);
Label.displayName = 'Label';

export { Label };
export type { LabelProps };
