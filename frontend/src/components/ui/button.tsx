import {
  Button as MantineButton,
  type ButtonProps as MantineButtonProps,
  type PolymorphicComponentProps,
} from '@mantine/core';
import React from 'react';

type ShadcnVariant =
  | 'default'
  | 'destructive'
  | 'outline'
  | 'outline-primary'
  | 'secondary'
  | 'ghost'
  | 'link'
  | 'community'
  | 'warm'
  | 'success'
  | 'warning';

type ShadcnSize = 'default' | 'sm' | 'lg' | 'xl' | 'icon';

interface ButtonExtraProps {
  variant?: ShadcnVariant;
  size?: ShadcnSize;
  asChild?: boolean;
}

type ButtonProps = ButtonExtraProps &
  Omit<MantineButtonProps, 'variant' | 'size' | 'color'> & {
    className?: string;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    children?: React.ReactNode;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    id?: string;
    title?: string;
    'aria-label'?: string;
    'aria-current'?: string | boolean;
    component?: React.ElementType;
    to?: string;
    href?: string;
  };

const variantMap: Record<
  ShadcnVariant,
  { variant: MantineButtonProps['variant']; color?: string }
> = {
  default: { variant: 'filled', color: 'brand' },
  destructive: { variant: 'filled', color: 'red' },
  outline: { variant: 'outline', color: 'gray' },
  'outline-primary': { variant: 'outline', color: 'brand' },
  secondary: { variant: 'light', color: 'gray' },
  ghost: { variant: 'subtle', color: 'gray' },
  link: { variant: 'transparent', color: 'brand' },
  community: { variant: 'filled', color: 'teal' },
  warm: { variant: 'filled', color: 'orange' },
  success: { variant: 'filled', color: 'green' },
  warning: { variant: 'filled', color: 'yellow' },
};

const sizeMap: Record<ShadcnSize, MantineButtonProps['size']> = {
  default: 'sm',
  sm: 'xs',
  lg: 'md',
  xl: 'lg',
  icon: 'sm',
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'default',
      size = 'default',
      asChild = false,
      className,
      children,
      component,
      ...props
    },
    ref,
  ) => {
    const { variant: mv, color } = variantMap[variant] ?? variantMap.default;
    const ms = sizeMap[size] ?? 'sm';

    // asChild: use the child element's type as the `component` prop
    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<any>;
      const { children: childChildren, ...childProps } = child.props as any;
      return (
        <MantineButton
          ref={ref}
          component={child.type as React.ElementType}
          variant={mv}
          color={color}
          size={ms}
          className={className}
          {...childProps}
          {...props}
        >
          {childChildren}
        </MantineButton>
      );
    }

    // icon size: wrap children, force square shape
    const iconStyle = size === 'icon' ? { width: 36, height: 36, padding: 0 } : undefined;

    return (
      <MantineButton
        ref={ref}
        component={component as any}
        variant={mv}
        color={color}
        size={ms}
        className={className}
        style={iconStyle}
        {...props}
      >
        {children}
      </MantineButton>
    );
  },
);
Button.displayName = 'Button';

// buttonVariants is used in a few places for className generation
const buttonVariants = ({
  variant = 'default',
  size = 'default',
  className = '',
}: {
  variant?: ShadcnVariant;
  size?: ShadcnSize;
  className?: string;
} = {}): string => `${className}`;

export { Button, buttonVariants };
export type { ButtonProps };
