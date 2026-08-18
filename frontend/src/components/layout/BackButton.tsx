import { useLanguage } from '@/contexts/LanguageContext';
import { ActionIcon } from '@mantine/core';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface BackButtonProps {
  /** Override default browser-history back navigation, e.g. to guard
   *  against leaving with unsaved changes. */
  onClick?: () => void;
  className?: string;
}

/** Top-left back arrow that returns to the previous page in history,
 *  replacing the breadcrumb trail on detail/edit pages. */
export const BackButton = ({ onClick, className }: BackButtonProps) => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <ActionIcon
      type="button"
      variant="subtle"
      color="gray"
      size="lg"
      aria-label={t('nav.back')}
      onClick={onClick ?? (() => navigate(-1))}
      className={className}
    >
      <ArrowLeft size={20} />
    </ActionIcon>
  );
};
