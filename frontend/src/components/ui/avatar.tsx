import { Avatar as MantineAvatar, type AvatarProps as MantineAvatarProps } from '@mantine/core';
import React from 'react';

// ── Avatar ───────────────────────────────────────────────────────────────────

interface AvatarProps extends MantineAvatarProps {
  className?: string;
}

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, children, src, alt, ...props }, ref) => (
    <MantineAvatar ref={ref} src={src} alt={alt} className={className} {...props}>
      {children}
    </MantineAvatar>
  ),
);
Avatar.displayName = 'Avatar';

// ── AvatarImage ──────────────────────────────────────────────────────────────
// In Mantine, the image is passed as `src` to Avatar directly.
// This shim accepts src/alt and renders nothing (the parent Avatar handles it).

interface AvatarImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {}

const AvatarImage = React.forwardRef<HTMLImageElement, AvatarImageProps>((_props, _ref) => null);
AvatarImage.displayName = 'AvatarImage';

// ── AvatarFallback ───────────────────────────────────────────────────────────
// In Mantine, fallback content is passed as children to Avatar.
// This shim wraps children in a fragment.

interface AvatarFallbackProps extends React.HTMLAttributes<HTMLSpanElement> {}

const AvatarFallback = React.forwardRef<HTMLSpanElement, AvatarFallbackProps>(
  ({ children }, _ref) => <>{children}</>,
);
AvatarFallback.displayName = 'AvatarFallback';

export { Avatar, AvatarFallback, AvatarImage };
