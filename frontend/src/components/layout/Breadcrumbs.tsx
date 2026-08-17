import { useLanguage } from '@/contexts/LanguageContext';
import { Anchor, Breadcrumbs as MantineBreadcrumbs, Text } from '@mantine/core';
import { Link } from 'react-router-dom';

export interface BreadcrumbItem {
  label: string;
  /** Plain link target. Omit and pass `onClick` instead when navigating away
   *  needs to be intercepted (e.g. an unsaved-changes confirmation). */
  to?: string;
  onClick?: () => void;
}

interface BreadcrumbsProps {
  /** Ancestors first, current page last. The last item is always rendered as
   *  plain text — it's where the user already is, not a link. */
  items: BreadcrumbItem[];
  className?: string;
}

/** Hierarchical "you are here" trail for detail/edit pages, replacing ad-hoc
 *  back buttons (`navigate(-1)` or a single hard-coded parent) with an
 *  explicit, consistent parent chain the user can jump to at any level. */
export const Breadcrumbs = ({ items, className }: BreadcrumbsProps) => {
  const { t } = useLanguage();

  return (
    <MantineBreadcrumbs
      component="nav"
      aria-label={t('nav.breadcrumbs')}
      separator="/"
      className={className}
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        if (isLast) {
          return (
            <Text key={index} size="sm" c="dimmed" truncate maw={280}>
              {item.label}
            </Text>
          );
        }

        if (item.onClick) {
          return (
            <Anchor
              key={index}
              component="button"
              type="button"
              size="sm"
              c="dimmed"
              onClick={item.onClick}
            >
              {item.label}
            </Anchor>
          );
        }

        // A non-last item is expected to carry `to` or `onClick`; if neither
        // was passed, fall back to plain text rather than rendering a link
        // to an undefined destination.
        if (!item.to) {
          return (
            <Text key={index} size="sm" c="dimmed" truncate maw={280}>
              {item.label}
            </Text>
          );
        }

        return (
          <Anchor key={index} component={Link} to={item.to} size="sm" c="dimmed">
            {item.label}
          </Anchor>
        );
      })}
    </MantineBreadcrumbs>
  );
};
