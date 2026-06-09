import { Badge as MantineBadge, type BadgeProps as MantineBadgeProps } from '@mantine/core';
import React from 'react';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';

interface BadgeProps extends Omit<MantineBadgeProps, 'variant' | 'color'> {
  variant?: BadgeVariant;
  className?: string;
}

const variantMap: Record<BadgeVariant, { variant: MantineBadgeProps['variant']; color: string }> = {
  default: { variant: 'filled', color: 'brand' },
  secondary: { variant: 'light', color: 'gray' },
  destructive: { variant: 'filled', color: 'red' },
  outline: { variant: 'outline', color: 'gray' },
  success: { variant: 'filled', color: 'green' },
  warning: { variant: 'filled', color: 'orange' },
};

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ variant = 'default', className, children, ...props }, ref) => {
    const { variant: mv, color } = variantMap[variant] ?? variantMap.default;
    return (
      <MantineBadge ref={ref} variant={mv} color={color} className={className} {...props}>
        {children}
      </MantineBadge>
    );
  },
);
Badge.displayName = 'Badge';

export { Badge };
export type { BadgeProps };
