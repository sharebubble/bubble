import { useLanguage } from '@/contexts/LanguageContext';
import {
  groupsList,
  itemsCoOwnersCreate,
  itemsCoOwnersDestroy,
  itemsCoOwnersRetrieve,
  itemsViewersCreate,
  itemsViewersDestroy,
  itemsViewersRetrieve,
  usersList,
  VisibilityEnum,
} from '@/services/django';
import { ActionIcon, Button, Divider, Group, Paper, Text, TextInput } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState, useRef } from 'react';

interface AccessEntry {
  id: string | number;
  username?: string;
  name?: string;
}

interface AccessList {
  users: AccessEntry[];
  groups: AccessEntry[];
}

interface AccessManagerProps {
  itemId: string;
  visibility: VisibilityEnum | '';
}

/** Reusable row for removing a user or group from a list. */
const AccessRow = ({ label, onRemove }: { label: string; onRemove: () => void }) => (
  <Group
    justify="space-between"
    wrap="nowrap"
    py={4}
    px={8}
    bg="gray.1"
    style={{ borderRadius: 'var(--mantine-radius-sm)' }}
  >
    <Text size="sm">{label}</Text>
    <ActionIcon variant="subtle" color="gray" size="sm" onClick={onRemove}>
      <X size={12} />
    </ActionIcon>
  </Group>
);

/** Panel for managing either co-owners or viewers. */
const AccessPanel = ({
  title,
  description,
  data,
  isLoading,
  onAddUser,
  onAddGroup,
  onRemoveUser,
  onRemoveGroup,
  mutating,
}: {
  title: string;
  description: string;
  data: AccessList | undefined;
  isLoading: boolean;
  onAddUser: (id: string | number) => void;
  onAddGroup: (id: string | number) => void;
  onRemoveUser: (id: string | number) => void;
  onRemoveGroup: (id: string | number) => void;
  mutating: boolean;
}) => {
  const { t } = useLanguage();
  const [userSearch, setUserSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [userFocused, setUserFocused] = useState(false);
  const [groupFocused, setGroupFocused] = useState(false);

  // Use refs to manage blur delay (so clicking a result doesn't close the list first)
  const userBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: allUsers } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await usersList();
      return res.data?.results ?? [];
    },
  });

  const { data: allGroups } = useQuery({
    queryKey: ['groups'],
    queryFn: async () => {
      const res = await groupsList();
      return res.data?.results ?? [];
    },
  });

  const existingUserIds = new Set((data?.users ?? []).map(u => String(u.id)));
  const existingGroupIds = new Set((data?.groups ?? []).map(g => String(g.id)));

  const filteredUsers = (allUsers ?? []).filter(
    u =>
      !existingUserIds.has(String(u.id)) &&
      (userSearch.length === 0 ||
        u.username?.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.name?.toLowerCase().includes(userSearch.toLowerCase())),
  );

  const filteredGroups = (allGroups ?? []).filter(
    g =>
      !existingGroupIds.has(String(g.id)) &&
      (groupSearch.length === 0 || g.name?.toLowerCase().includes(groupSearch.toLowerCase())),
  );

  const showUserDropdown = userFocused && filteredUsers.length > 0;
  const showGroupDropdown = groupFocused && filteredGroups.length > 0;

  return (
    <div className="space-y-4">
      <div>
        <Text size="sm" fw={500}>
          {title}
        </Text>
        <Text size="xs" c="dimmed">
          {description}
        </Text>
      </div>

      {isLoading && (
        <Text size="xs" c="dimmed">
          {t('common.loading')}
        </Text>
      )}

      {/* Current users */}
      {(data?.users ?? []).length > 0 && (
        <div className="space-y-1">
          <Text size="xs" fw={500}>
            {t('accessManager.users')}
          </Text>
          {data!.users.map(u => (
            <AccessRow
              key={`user-${u.id}`}
              label={u.username ?? String(u.id)}
              onRemove={() => onRemoveUser(u.id)}
            />
          ))}
        </div>
      )}

      {/* Current groups */}
      {(data?.groups ?? []).length > 0 && (
        <div className="space-y-1">
          <Text size="xs" fw={500}>
            {t('accessManager.groups')}
          </Text>
          {data!.groups.map(g => (
            <AccessRow
              key={`group-${g.id}`}
              label={g.name ?? String(g.id)}
              onRemove={() => onRemoveGroup(g.id)}
            />
          ))}
        </div>
      )}

      {/* Add user */}
      <div className="space-y-1 relative">
        <TextInput
          size="xs"
          label={t('accessManager.addUser')}
          placeholder={t('accessManager.searchUsers')}
          value={userSearch}
          onChange={e => setUserSearch(e.target.value)}
          onFocus={() => {
            if (userBlurTimer.current) clearTimeout(userBlurTimer.current);
            setUserFocused(true);
          }}
          onBlur={() => {
            userBlurTimer.current = setTimeout(() => setUserFocused(false), 150);
          }}
          disabled={mutating}
          autoComplete="off"
        />
        {showUserDropdown && (
          <Paper
            withBorder
            shadow="md"
            className="absolute z-10 left-0 right-0 p-1 space-y-1 max-h-40 overflow-y-auto"
          >
            {filteredUsers.map(u => (
              <Button
                key={u.id}
                type="button"
                variant="subtle"
                color="gray"
                size="compact-sm"
                fullWidth
                justify="flex-start"
                onMouseDown={e => e.preventDefault()} // keep focus on input during click
                onClick={() => {
                  onAddUser(u.id);
                  setUserSearch('');
                  setUserFocused(false);
                }}
                disabled={mutating}
              >
                {u.username}
              </Button>
            ))}
          </Paper>
        )}
      </div>

      {/* Add group */}
      <div className="space-y-1 relative">
        <TextInput
          size="xs"
          label={t('accessManager.addGroup')}
          placeholder={t('accessManager.searchGroups')}
          value={groupSearch}
          onChange={e => setGroupSearch(e.target.value)}
          onFocus={() => {
            if (groupBlurTimer.current) clearTimeout(groupBlurTimer.current);
            setGroupFocused(true);
          }}
          onBlur={() => {
            groupBlurTimer.current = setTimeout(() => setGroupFocused(false), 150);
          }}
          disabled={mutating}
          autoComplete="off"
        />
        {showGroupDropdown && (
          <Paper
            withBorder
            shadow="md"
            className="absolute z-10 left-0 right-0 p-1 space-y-1 max-h-40 overflow-y-auto"
          >
            {filteredGroups.map(g => (
              <Button
                key={g.id}
                type="button"
                variant="subtle"
                color="gray"
                size="compact-sm"
                fullWidth
                justify="flex-start"
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  onAddGroup(g.id);
                  setGroupSearch('');
                  setGroupFocused(false);
                }}
                disabled={mutating}
              >
                {g.name}
              </Button>
            ))}
          </Paper>
        )}
      </div>
    </div>
  );
};

/**
 * AccessManager — lets the item owner manage co-owners and specific viewers.
 * Viewers panel is only shown when visibility is SPECIFIC (2).
 * The component is rendered inside the collapsible access section in EditItem,
 * directly below the VisibilityField, so viewers are contextually grouped with it.
 */
export const AccessManager = ({ itemId, visibility }: AccessManagerProps) => {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const coOwnersKey = ['item-co-owners', itemId];
  const viewersKey = ['item-viewers', itemId];

  const { data: coOwners, isLoading: loadingCoOwners } = useQuery({
    queryKey: coOwnersKey,
    queryFn: async () => {
      const res = await itemsCoOwnersRetrieve({ path: { id: itemId } });
      return (res.data ?? { users: [], groups: [] }) as unknown as AccessList;
    },
  });

  const { data: viewers, isLoading: loadingViewers } = useQuery({
    queryKey: viewersKey,
    queryFn: async () => {
      const res = await itemsViewersRetrieve({ path: { id: itemId } });
      return (res.data ?? { users: [], groups: [] }) as unknown as AccessList;
    },
    enabled: visibility === 2,
  });

  const addCoOwnerUser = useMutation({
    mutationFn: (userId: string | number) =>
      itemsCoOwnersCreate({ path: { id: itemId }, body: { user: userId } as any }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: coOwnersKey }),
  });

  const removeCoOwnerUser = useMutation({
    mutationFn: (userId: string | number) =>
      itemsCoOwnersDestroy({ path: { id: itemId }, body: { user: userId } as any }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: coOwnersKey }),
  });

  const addCoOwnerGroup = useMutation({
    mutationFn: (groupId: string | number) =>
      itemsCoOwnersCreate({ path: { id: itemId }, body: { group: groupId } as any }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: coOwnersKey }),
  });

  const removeCoOwnerGroup = useMutation({
    mutationFn: (groupId: string | number) =>
      itemsCoOwnersDestroy({ path: { id: itemId }, body: { group: groupId } as any }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: coOwnersKey }),
  });

  const addViewerUser = useMutation({
    mutationFn: (userId: string | number) =>
      itemsViewersCreate({ path: { id: itemId }, body: { user: userId } as any }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: viewersKey }),
  });

  const removeViewerUser = useMutation({
    mutationFn: (userId: string | number) =>
      itemsViewersDestroy({ path: { id: itemId }, body: { user: userId } as any }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: viewersKey }),
  });

  const addViewerGroup = useMutation({
    mutationFn: (groupId: string | number) =>
      itemsViewersCreate({ path: { id: itemId }, body: { group: groupId } as any }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: viewersKey }),
  });

  const removeViewerGroup = useMutation({
    mutationFn: (groupId: string | number) =>
      itemsViewersDestroy({ path: { id: itemId }, body: { group: groupId } as any }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: viewersKey }),
  });

  const anyMutating =
    addCoOwnerUser.isPending ||
    removeCoOwnerUser.isPending ||
    addCoOwnerGroup.isPending ||
    removeCoOwnerGroup.isPending ||
    addViewerUser.isPending ||
    removeViewerUser.isPending ||
    addViewerGroup.isPending ||
    removeViewerGroup.isPending;

  return (
    <div className="space-y-6">
      {/* Viewers panel — directly below VisibilityField, only shown for SPECIFIC visibility */}
      {visibility === 2 && (
        <AccessPanel
          title={t('accessManager.viewersTitle')}
          description={t('accessManager.viewersDescription')}
          data={viewers}
          isLoading={loadingViewers}
          onAddUser={id => addViewerUser.mutate(id)}
          onAddGroup={id => addViewerGroup.mutate(id)}
          onRemoveUser={id => removeViewerUser.mutate(id)}
          onRemoveGroup={id => removeViewerGroup.mutate(id)}
          mutating={anyMutating}
        />
      )}

      {/* Divider only when both panels are visible */}
      {visibility === 2 && <Divider />}

      {/* Co-owners panel — always shown */}
      <AccessPanel
        title={t('accessManager.coOwnersTitle')}
        description={t('accessManager.coOwnersDescription')}
        data={coOwners}
        isLoading={loadingCoOwners}
        onAddUser={id => addCoOwnerUser.mutate(id)}
        onAddGroup={id => addCoOwnerGroup.mutate(id)}
        onRemoveUser={id => removeCoOwnerUser.mutate(id)}
        onRemoveGroup={id => removeCoOwnerGroup.mutate(id)}
        mutating={anyMutating}
      />
    </div>
  );
};
