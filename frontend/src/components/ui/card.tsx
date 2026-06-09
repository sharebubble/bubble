import {
  Card as MantineCard,
  type CardProps as MantineCardProps,
  Text,
  Title,
} from '@mantine/core';
import React from 'react';

// ── Card ────────────────────────────────────────────────────────────────────

interface CardProps extends Omit<MantineCardProps, 'shadow'> {
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, children, ...props }, ref) => (
    <MantineCard ref={ref} withBorder shadow="sm" className={className} {...props}>
      {children}
    </MantineCard>
  ),
);
Card.displayName = 'Card';

// ── CardHeader ───────────────────────────────────────────────────────────────

interface CardSectionProps extends React.HTMLAttributes<HTMLDivElement> {}

const CardHeader = React.forwardRef<HTMLDivElement, CardSectionProps>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={`p-6 pb-2 ${className ?? ''}`} {...props}>
      {children}
    </div>
  ),
);
CardHeader.displayName = 'CardHeader';

// ── CardContent ──────────────────────────────────────────────────────────────

const CardContent = React.forwardRef<HTMLDivElement, CardSectionProps>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={`p-6 pt-0 ${className ?? ''}`} {...props}>
      {children}
    </div>
  ),
);
CardContent.displayName = 'CardContent';

// ── CardFooter ───────────────────────────────────────────────────────────────

const CardFooter = React.forwardRef<HTMLDivElement, CardSectionProps>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={`flex items-center p-6 pt-0 ${className ?? ''}`} {...props}>
      {children}
    </div>
  ),
);
CardFooter.displayName = 'CardFooter';

// ── CardTitle ────────────────────────────────────────────────────────────────

interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {}

const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, children, ...props }, ref) => (
    <Title
      ref={ref}
      order={3}
      className={`font-semibold leading-none tracking-tight ${className ?? ''}`}
      {...props}
    >
      {children}
    </Title>
  ),
);
CardTitle.displayName = 'CardTitle';

// ── CardDescription ──────────────────────────────────────────────────────────

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => (
  <Text ref={ref} size="sm" c="dimmed" className={className} {...props}>
    {children}
  </Text>
));
CardDescription.displayName = 'CardDescription';

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
