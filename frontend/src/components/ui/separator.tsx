import { Divider, type DividerProps } from '@mantine/core';
import React from 'react';

interface SeparatorProps extends DividerProps {
  className?: string;
  orientation?: 'horizontal' | 'vertical';
  decorative?: boolean;
}

const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, orientation = 'horizontal', decorative: _decorative, ...props }, ref) => (
    <Divider
      ref={ref}
      orientation={orientation === 'vertical' ? 'vertical' : 'horizontal'}
      className={className}
      {...props}
    />
  ),
);
Separator.displayName = 'Separator';

export { Separator };
