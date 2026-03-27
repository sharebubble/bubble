import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';
import { useManageCollectionPermission, useCollectionPermissions } from '@/hooks/useCollections';
import { type CollectionGrant } from '@/services/django';
import { groupsList, usersList } from '@/services/django';
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
      (u as any).name?.toLowerCase().includes(search.toLowerCase()),
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
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t('collections.currentGrants')}
        </p>
        {grantsLoading ? (
          <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
        ) : !grants || grants.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('collections.noGrants')}</p>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                    {t('collections.grantType')}
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                    {t('collections.grantSubject')}
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                    {t('collections.grantPermissionCol')}
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {grants.map((grant, i) => {
                  const isCreator =
                    grant.subject_type === 'user' &&
                    ownerUsername !== undefined &&
                    grant.subject_name === ownerUsername;
                  return (
                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 text-muted-foreground">
                        {grant.subject_type === 'user'
                          ? t('collections.permUser')
                          : t('collections.permGroup')}
                      </td>
                      <td className="px-3 py-2 font-medium">{grant.subject_name}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {t(ROLE_LABEL_KEY[grant.permission] ?? grant.permission)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          disabled={managePermission.isPending || isCreator}
                          onClick={() => handleRevoke(grant)}
                          title={
                            isCreator
                              ? t('collections.ownerCannotRevoke')
                              : t('collections.revokeGrant')
                          }
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Grant form */}
      <div className="space-y-3 pt-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t('collections.action')}
        </p>

        {/* User / Group toggle */}
        <Tabs value={subjectType} onValueChange={handleSubjectTypeChange}>
          <TabsList className="h-8">
            <TabsTrigger value="group" className="text-xs px-3">
              {t('collections.subjectTypeGroup')}
            </TabsTrigger>
            <TabsTrigger value="user" className="text-xs px-3">
              {t('collections.subjectTypeUser')}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Subject picker */}
          <div className="space-y-1">
            <Label className="text-xs">
              {subjectType === 'user' ? t('collections.username') : t('collections.groupName')}
            </Label>
            {selectedId ? (
              <div className="flex items-center gap-2 h-9 px-3 border rounded text-sm bg-muted">
                <span className="flex-1 truncate">{selectedName}</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground text-xs shrink-0"
                  onClick={clearSelection}
                >
                  ✕
                </button>
              </div>
            ) : (
              <>
                <Input
                  placeholder={
                    subjectType === 'user'
                      ? t('collections.usernamePlaceholder')
                      : t('collections.groupPlaceholder')
                  }
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setTimeout(() => setInputFocused(false), 150)}
                  className="h-9 text-sm"
                />
                {inputFocused && (
                  <>
                    {subjectType === 'user' && filteredUsers.length > 0 && (
                      <div className="border rounded p-1 space-y-1 max-h-32 overflow-y-auto">
                        {filteredUsers.slice(0, 10).map(u => (
                          <button
                            key={u.id}
                            type="button"
                            className="w-full text-left text-sm px-2 py-1 rounded hover:bg-muted"
                            onClick={() => {
                              setSelectedId(u.id);
                              setSelectedName(u.username ?? String(u.id));
                              setSearch('');
                            }}
                          >
                            {u.username}
                          </button>
                        ))}
                      </div>
                    )}
                    {subjectType === 'group' && filteredGroups.length > 0 && (
                      <div className="border rounded p-1 space-y-1 max-h-32 overflow-y-auto">
                        {filteredGroups.slice(0, 10).map(g => (
                          <button
                            key={g.id}
                            type="button"
                            className="w-full text-left text-sm px-2 py-1 rounded hover:bg-muted"
                            onClick={() => {
                              setSelectedId(String(g.id));
                              setSelectedName(g.name ?? String(g.id));
                              setSearch('');
                            }}
                          >
                            {g.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* Role selector */}
          <div className="space-y-1">
            <Label className="text-xs">{t('collections.permission')}</Label>
            <Select value={role} onValueChange={v => setRole(v as Role)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Share button */}
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleShare}
            disabled={!selectedId || managePermission.isPending}
          >
            <Share2 className="w-4 h-4 mr-2" />
            {t('collections.grantPermission')}
          </Button>
        </div>
      </div>
    </div>
  );
};
