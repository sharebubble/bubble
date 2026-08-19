import { BROWSE_PATH } from '@/lib/routes';
import { usersRetrieve } from '@/services/django/sdk.gen';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

/** Clickable owner name — links to all items listed by this user. */
const OwnerLink = ({ userUuid }: { userUuid: string }) => {
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
    <Link
      to={`${BROWSE_PATH}?owner=${userUuid}`}
      onClick={e => e.stopPropagation()}
      className="underline underline-offset-2 hover:text-[var(--mantine-color-blue-6)]"
    >
      {owner.name || owner.username}
    </Link>
  );
};

export default OwnerLink;
