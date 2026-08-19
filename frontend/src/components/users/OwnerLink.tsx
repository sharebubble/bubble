import { useLanguage } from '@/contexts/LanguageContext';
import { BROWSE_PATH } from '@/lib/routes';
import { usersRetrieve } from '@/services/django/sdk.gen';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

/**
 * "by <owner name>" — links to all items listed by this user. Self-contained
 * (includes the "by" word) so it renders atomically: nothing shows while
 * loading or if the lookup fails, rather than leaving a dangling "by".
 * Only mount this for authenticated viewers — the user-lookup endpoint
 * requires auth and 403s for anonymous requests.
 */
const OwnerLink = ({ userUuid }: { userUuid: string }) => {
  const { t } = useLanguage();
  const { data: owner } = useQuery({
    queryKey: ['user', userUuid],
    queryFn: async () => {
      const resp = await usersRetrieve({ path: { id: userUuid } });
      return resp.data;
    },
    enabled: !!userUuid,
  });

  if (!owner) return null;

  return (
    <>
      {t('itemDetail.by')}{' '}
      <Link
        to={`${BROWSE_PATH}?owner=${userUuid}`}
        onClick={e => e.stopPropagation()}
        className="underline underline-offset-2 hover:text-[var(--mantine-color-blue-6)]"
      >
        {owner.name || owner.username}
      </Link>
    </>
  );
};

export default OwnerLink;
