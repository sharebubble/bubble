import { useComputedColorScheme } from '@mantine/core';
import { useEffect } from 'react';

/**
 * Mirrors Mantine's resolved color scheme onto the `.dark` class of <html>
 * so Tailwind `dark:` utilities keep working during the Mantine migration.
 * Remove once no `dark:` utilities remain.
 */
export function ColorSchemeSync() {
  const computed = useComputedColorScheme('light');

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(computed);
  }, [computed]);

  return null;
}
