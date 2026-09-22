import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import {
  ledgerAccountsEntriesList,
  ledgerAccountsList,
  ledgerAccountsMeRetrieve,
  ledgerAccountsRetrieve,
  ledgerCategoriesList,
  ledgerHealthRetrieve,
  ledgerProjectsList,
  ledgerReceiptsFileRetrieve,
  ledgerTransactionsCreate,
  ledgerTransactionsList,
  ledgerTransactionsRetrieve,
  type LedgerAccount,
  type LedgerIntent,
  type LedgerTransactionsListData,
} from '@/services/django';
import { notifications } from '@mantine/notifications';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const LEDGER_KEY = ['ledger'] as const;

export type LedgerTransactionFilters = NonNullable<LedgerTransactionsListData['query']>;

/** The signed-in member's own account: balance, soft limit, treasurer flag. */
export const useMyLedgerAccount = () => {
  const { session } = useAuth();
  return useQuery({
    queryKey: [...LEDGER_KEY, 'accounts', 'me'],
    enabled: !!session,
    queryFn: async () => (await ledgerAccountsMeRetrieve()).data,
  });
};

export const useLedgerAccount = (id?: string) =>
  useQuery({
    queryKey: [...LEDGER_KEY, 'accounts', id],
    enabled: !!id,
    queryFn: async () => (await ledgerAccountsRetrieve({ path: { id: id! } })).data,
  });

/** Every member's balance, alphabetically — the ledger is transparent (D8). */
export const useLedgerBalances = () =>
  useInfiniteQuery({
    queryKey: [...LEDGER_KEY, 'accounts', 'members'],
    queryFn: async ({ pageParam }) =>
      (await ledgerAccountsList({ query: { type: 'member', page: pageParam } })).data,
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage?.next ? allPages.length + 1 : undefined),
  });

/** Active members to pick as a counterparty. */
export const useLedgerMembers = (enabled: boolean) =>
  useQuery({
    queryKey: [...LEDGER_KEY, 'accounts', 'members', 'all'],
    enabled,
    queryFn: async () => {
      const members: LedgerAccount[] = [];
      for (let page = 1; ; page += 1) {
        const { data } = await ledgerAccountsList({
          query: { type: 'member', is_active: true, page },
        });
        members.push(...data.results);
        if (!data.next) return members;
      }
    },
  });

/** The community feed, newest first, one page of 20 at a time. */
export const useLedgerTransactions = (filters: LedgerTransactionFilters = {}) =>
  useInfiniteQuery({
    queryKey: [...LEDGER_KEY, 'transactions', filters],
    queryFn: async ({ pageParam }) =>
      (await ledgerTransactionsList({ query: { ...filters, page: pageParam } })).data,
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage?.next ? allPages.length + 1 : undefined),
  });

export const useLedgerTransaction = (id?: string) =>
  useQuery({
    queryKey: [...LEDGER_KEY, 'transactions', 'detail', id],
    enabled: !!id,
    queryFn: async () => (await ledgerTransactionsRetrieve({ path: { id: id! } })).data,
  });

/** An account statement: entries newest first, each with the balance after it. */
export const useLedgerAccountEntries = (accountId?: string) =>
  useInfiniteQuery({
    queryKey: [...LEDGER_KEY, 'accounts', accountId, 'entries'],
    enabled: !!accountId,
    queryFn: async ({ pageParam }) =>
      (await ledgerAccountsEntriesList({ path: { id: accountId! }, query: { page: pageParam } }))
        .data,
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage?.next ? allPages.length + 1 : undefined),
  });

export const useLedgerCategories = (kind?: 'income' | 'expense') =>
  useQuery({
    queryKey: [...LEDGER_KEY, 'categories', kind],
    queryFn: async () => (await ledgerCategoriesList({ query: { kind } })).data,
    staleTime: 5 * 60 * 1000,
  });

export const useLedgerProjects = () =>
  useQuery({
    queryKey: [...LEDGER_KEY, 'projects'],
    queryFn: async () => (await ledgerProjectsList()).data,
    staleTime: 5 * 60 * 1000,
  });

/** Trial balance and cache check; the UI shows a warning when it fails. */
export const useLedgerHealth = () =>
  useQuery({
    queryKey: [...LEDGER_KEY, 'health'],
    queryFn: async () => (await ledgerHealthRetrieve()).data,
    staleTime: 5 * 60 * 1000,
  });

export type NewLedgerTransaction = Omit<LedgerIntent, 'receipts'> & { receipts?: File[] };

/** Post a manual transaction (an intent); the server expands it into legs. */
export const usePostLedgerTransaction = () => {
  const queryClient = useQueryClient();
  const { t } = useLanguage();

  return useMutation({
    mutationFn: async ({ receipts, ...intent }: NewLedgerTransaction) => {
      const response = await ledgerTransactionsCreate({
        // The generated type describes multipart files as strings; the form
        // serializer appends the File objects as they are.
        body: { ...intent, receipts: receipts as unknown as string[] | undefined },
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LEDGER_KEY });
      notifications.show({ message: t('ledger.posted'), color: 'green' });
    },
  });
};

/** Download a receipt through the authenticated, access-logged endpoint. */
export const useDownloadReceipt = () => {
  const { t } = useLanguage();

  return useMutation({
    mutationFn: async ({ id, fileName }: { id: string; fileName: string }) => {
      const response = await ledgerReceiptsFileRetrieve({
        path: { id },
        parseAs: 'blob',
      });
      const url = URL.createObjectURL(response.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    },
    onError: () => {
      notifications.show({ message: t('ledger.receiptDownloadFailed'), color: 'red' });
    },
  });
};
