import { useLanguage } from '@/contexts/LanguageContext';
import { useManageCollectionPermission, useCollectionPermissions } from '@/hooks/useCollections';
import { type CollectionGrant } from '@/services/django';
import { groupsList, usersList } from '@/services/django';
import {
  ActionIcon,
  Button,
  CloseButton,
  Paper,
  SegmentedControl,
  Select,
  Table,
  Text,
} from '@mantine/core';
import { TextInput } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Share2, Shield, Trash2 } from 'lucide-react';
import { useState } from 'react';

type Role = 'view' | 'edit' | 'owner';
type SubjectType = 'user' | 'group';

interface CollectionPermissionsPanelProps {
  collectionId: string;
  ownerUsername?: string;
}

const ROLE_LABEL_KEY: Record<string, string> = {
  view: 'collections.roleView',
  edit: 'collections.roleEdit',
  owner: 'collections.roleOwner',
};

/**
 * Panel for granting/revoking guardian object-level permissions on a collection
 * using three named roles: View, Edit, Owner.
 *
 * Current grants are shown per subject with an inline revoke button.
 * The grant form lets the owner pick a user/group and a role, then Share.
 */
export const CollectionPermissionsPanel = ({
  collectionId,
  ownerUsername,
}: CollectionPermissionsPanelProps) => {
  const { t } = useLanguage();
  const managePermission = useManageCollectionPermission();
  const { data: grants, isLoading: grantsLoading } = useCollectionPermissions(collectionId);

  const [subjectType, setSubjectType] = useState<SubjectType>('group');
  const [search, setSearch] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [role, setRole] = useState<Role>('view');

  const { data: allUsers } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await usersList();
      return res.data?.results ?? [];
    },
    enabled: subjectType === 'user',
  });

  const { data: allGroups } = useQuery({
    queryKey: ['groups'],
    queryFn: async () => {
      const res = await groupsList();
      return res.data?.results ?? [];
    },
    enabled: subjectType === 'group',
  });

  const filteredUsers = (allUsers ?? []).filter(
    u =>
      u.username?.toLowerCase().includes(search.toLowerCase()) ||
      (u as { name?: string }).name?.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredGroups = (allGroups ?? []).filter(g =>
    g.name?.toLowerCase().includes(search.toLowerCase()),
  );

  const clearSelection = () => {
    setSelectedId('');
    setSelectedName('');
    setSearch('');
    setInputFocused(false);
  };

  const handleSubjectTypeChange = (val: string) => {
    setSubjectType(val as SubjectType);
    clearSelection();
  };

  const handleShare = () => {
    if (!selectedId) return;
    const payload =
      subjectType === 'user'
        ? { collectionId, userId: selectedId, role, action: 'grant' as const }
        : { collectionId, groupId: selectedId, role, action: 'grant' as const };
    managePermission.mutate(payload);
    clearSelection();
  };

  const handleRevoke = (grant: CollectionGrant) => {
    // grant.permission carries the role value after the backend change
    const grantRole = (grant.permission as Role) ?? 'view';
    const payload =
      grant.subject_type === 'user'
        ? { collectionId, userId: grant.subject_id, role: grantRole, action: 'revoke' as const }
        : { collectionId, groupId: grant.subject_id, role: grantRole, action: 'revoke' as const };
    managePermission.mutate(payload);
  };

  const roleOptions: { value: Role; label: string }[] = [
    { value: 'view', label: t('collections.roleView') },
    { value: 'edit', label: t('collections.roleEdit') },
    { value: 'owner', label: t('collections.roleOwner') },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{t('collections.permissions')}</h3>
      </div>

      {/* Current grants table */}
      <div className="space-y-2">
        <Text size="xs" fw={500} c="dimmed" tt="uppercase" className="tracking-wide">
          {t('collections.currentGrants')}
        </Text>
        {grantsLoading ? (
          <Text size="xs" c="dimmed">
            {t('common.loading')}
          </Text>
        ) : !grants || grants.length === 0 ? (
          <Text size="xs" c="dimmed">
            {t('collections.noGrants')}
          </Text>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <Table fz="xs" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th c="dimmed">{t('collections.grantType')}</Table.Th>
                  <Table.Th c="dimmed">{t('collections.grantSubject')}</Table.Th>
                  <Table.Th c="dimmed">{t('collections.grantPermissionCol')}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {grants.map((grant, i) => {
                  const isCreator =
                    grant.subject_type === 'user' &&
                    ownerUsername !== undefined &&
                    grant.subject_name === ownerUsername;
                  return (
                    <Table.Tr key={i}>
                      <Table.Td c="dimmed">
                        {grant.subject_type === 'user'
                          ? t('collections.permUser')
                          : t('collections.permGroup')}
                      </Table.Td>
                      <Table.Td className="font-medium">{grant.subject_name}</Table.Td>
                      <Table.Td c="dimmed">
                        {t(ROLE_LABEL_KEY[grant.permission] ?? grant.permission)}
                      </Table.Td>
                      <Table.Td className="text-right">
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          size="sm"
                          disabled={managePermission.isPending || isCreator}
                          onClick={() => handleRevoke(grant)}
                          title={
                            isCreator
                              ? t('collections.ownerCannotRevoke')
                              : t('collections.revokeGrant')
                          }
                          aria-label={
                            isCreator
                              ? t('collections.ownerCannotRevoke')
                              : t('collections.revokeGrant')
                          }
                        >
                          <Trash2 size={12} />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </div>
        )}
      </div>

      {/* Grant form */}
      <div className="space-y-3 pt-1">
        <Text size="xs" fw={500} c="dimmed" tt="uppercase" className="tracking-wide">
          {t('collections.action')}
        </Text>

        {/* User / Group toggle */}
        <SegmentedControl
          size="xs"
          value={subjectType}
          onChange={handleSubjectTypeChange}
          data={[
            { value: 'group', label: t('collections.subjectTypeGroup') },
            { value: 'user', label: t('collections.subjectTypeUser') },
          ]}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Subject picker */}
          <div className="space-y-1">
            <Text component="label" size="xs" fw={500} className="block">
              {subjectType === 'user' ? t('collections.username') : t('collections.groupName')}
            </Text>
            {selectedId ? (
              <Paper
                withBorder
                radius="sm"
                px="sm"
                bg="gray.1"
                className="flex items-center gap-2 h-9"
              >
                <Text size="sm" truncate className="flex-1">
                  {selectedName}
                </Text>
                <CloseButton size="sm" className="shrink-0" onClick={clearSelection} />
              </Paper>
            ) : (
              <>
                <TextInput
                  size="sm"
                  placeholder={
                    subjectType === 'user'
                      ? t('collections.usernamePlaceholder')
                      : t('collections.groupPlaceholder')
                  }
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setTimeout(() => setInputFocused(false), 150)}
                />
                {inputFocused && (
                  <>
                    {subjectType === 'user' && filteredUsers.length > 0 && (
                      <Paper withBorder radius="sm" p={4} className="space-y-1 max-h-32 overflow-y-auto">
                        {filteredUsers.slice(0, 10).map(u => (
                          <Button
                            key={u.id}
                            variant="subtle"
                            color="gray"
                            size="compact-sm"
                            fullWidth
                            justify="flex-start"
                            onClick={() => {
                              setSelectedId(u.id);
                              setSelectedName(u.username ?? String(u.id));
                              setSearch('');
                            }}
                          >
                            {u.username}
                          </Button>
                        ))}
                      </Paper>
                    )}
                    {subjectType === 'group' && filteredGroups.length > 0 && (
                      <Paper withBorder radius="sm" p={4} className="space-y-1 max-h-32 overflow-y-auto">
                        {filteredGroups.slice(0, 10).map(g => (
                          <Button
                            key={g.id}
                            variant="subtle"
                            color="gray"
                            size="compact-sm"
                            fullWidth
                            justify="flex-start"
                            onClick={() => {
                              setSelectedId(String(g.id));
                              setSelectedName(g.name ?? String(g.id));
                              setSearch('');
                            }}
                          >
                            {g.name}
                          </Button>
                        ))}
                      </Paper>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* Role selector */}
          <div className="space-y-1">
            <Text component="label" size="xs" fw={500} className="block">
              {t('collections.permission')}
            </Text>
            <Select
              size="sm"
              value={role}
              onChange={v => {
                if (v) setRole(v as Role);
              }}
              data={roleOptions}
              allowDeselect={false}
            />
          </div>
        </div>

        {/* Share button */}
        <div className="flex gap-2">
          <Button
            size="sm"
            leftSection={<Share2 size={16} />}
            onClick={handleShare}
            disabled={!selectedId || managePermission.isPending}
          >
            {t('collections.grantPermission')}
          </Button>
        </div>
      </div>
    </div>
  );
};
