import { useLanguage } from '@/contexts/LanguageContext';
import { usersRetrieve } from '@/services/django/sdk.gen';
import { useQuery } from '@tanstack/react-query';

const UserInfoBox = ({ userUuid }: { userUuid: string }) => {
  const { t } = useLanguage();

  const {
    data: owner,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['user', userUuid],
    queryFn: async () => {
      const resp = await usersRetrieve({ path: { id: userUuid } });
      return resp.data;
    },
    enabled: !!userUuid,
  });

  if (!userUuid) return null;

  return (
    <div className="mt-6 rounded-md border p-4 bg-card">
      <h3 className="text-lg font-semibold">{t('itemDetail.ownerInfo')}</h3>
      {isLoading && <p className="text-sm text-muted-foreground">{t('common.loading')}</p>}
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {owner && (
        <div className="mt-2 text-sm space-y-1">
          <div>
            <strong>{t('user.name')}:</strong> {owner.name || owner.username || owner.email}
          </div>
          {owner.email && (
            <div>
              <strong>{t('user.email')}:</strong> {owner.email}
            </div>
          )}
          {/* Add more fields as needed, keep it minimal for privacy */}
        </div>
      )}
    </div>
  );
};

export default UserInfoBox;
