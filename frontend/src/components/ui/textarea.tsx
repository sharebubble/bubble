import {
  Textarea as MantineTextarea,
  type TextareaProps as MantineTextareaProps,
} from '@mantine/core';
import React from 'react';

interface TextareaProps extends MantineTextareaProps {
  className?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <MantineTextarea ref={ref} classNames={{ input: className }} {...props} />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
