import { useLanguage } from '@/contexts/LanguageContext';
import { usersRetrieve } from '@/services/django/sdk.gen';
import { Card, Text, Title } from '@mantine/core';
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
    <Card withBorder padding="lg" className="mt-6">
      <Title order={3} size="h4">
        {t('itemDetail.ownerInfo')}
      </Title>
      {isLoading && (
        <Text size="sm" c="dimmed">
          {t('common.loading')}
        </Text>
      )}
      {error && (
        <Text size="sm" c="red">
          {(error as Error).message}
        </Text>
      )}
      {owner && (
        <div className="mt-2 space-y-1">
          <Text size="sm">
            <strong>{t('user.name')}:</strong> {owner.name || owner.username || owner.email}
          </Text>
          {owner.email && (
            <Text size="sm">
              <strong>{t('user.email')}:</strong> {owner.email}
            </Text>
          )}
          {/* Add more fields as needed, keep it minimal for privacy */}
        </div>
      )}
    </Card>
  );
};

export default UserInfoBox;
