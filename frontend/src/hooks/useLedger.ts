import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import {
  ledgerAccountsEntriesList,
  ledgerAccountsList,
  ledgerAccountsMeRetrieve,
  ledgerAccountsRetrieve,
  ledgerAccountsStatementCsvRetrieve,
  ledgerAccountsStatementRetrieve,
  ledgerAccountsDatevCreate,
  ledgerBankImportsCreate,
  ledgerBankImportsList,
  ledgerBankLinesAssignCreate,
  ledgerBankLinesBookCreate,
  ledgerBankLinesCandidatesList,
  ledgerBankLinesIgnoreCreate,
  ledgerBankLinesLinkCreate,
  ledgerBankLinesList,
  ledgerBankLinesParkCreate,
  ledgerBankLinesReopenCreate,
  ledgerBankLinesSummaryRetrieve,
  ledgerCategoriesCreate,
  ledgerCategoriesList,
  ledgerCategoriesPartialUpdate,
  ledgerChainExportRetrieve,
  ledgerChainRetrieve,
  ledgerDisputesUpholdCreate,
  ledgerDisputesWithdrawCreate,
  ledgerExportsDatevRetrieve,
  ledgerExportsJournalRetrieve,
  ledgerHealthRetrieve,
  ledgerPeriodsCreate,
  ledgerPeriodsList,
  ledgerProjectsCreate,
  ledgerProjectsList,
  ledgerProjectsPartialUpdate,
  ledgerReceiptsFileRetrieve,
  ledgerReportsAnnualCsvRetrieve,
  ledgerReportsAnnualRetrieve,
  ledgerSplitsAcceptCreate,
  ledgerSplitsCancelCreate,
  ledgerSplitsCreate,
  ledgerSplitsList,
  ledgerSplitsObjectCreate,
  ledgerSplitsReceiptsCreate,
  ledgerSplitsRetrieve,
  ledgerSplitsUpdate,
  ledgerStatsRetrieve,
  ledgerTransactionsCommentsCreate,
  ledgerTransactionsCorrectCreate,
  ledgerTransactionsCreate,
  ledgerTransactionsDisputeCreate,
  ledgerTransactionsList,
  ledgerTransactionsRetrieve,
  ledgerTransactionsReverseCreate,
  ledgerUnbilledList,
  type LedgerAccount,
  type LedgerAccountTypeEnum,
  type LedgerBankBook,
  type LedgerBankLinesListData,
  type LedgerCategoryWrite,
  type LedgerProjectWrite,
  type LedgerStatsRetrieveData,
  type LedgerCorrectionLine,
  type LedgerCostShareWrite,
  type LedgerIntent,
  type LedgerSplitsListData,
  type LedgerTransactionsListData,
} from '@/services/django';
import { notifications } from '@mantine/notifications';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const LEDGER_KEY = ['ledger'] as const;
const BANK_KEY = [...LEDGER_KEY, 'bank'] as const;

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

/** Bookings that should have been charged but could not be (treasurer only). */
export const useLedgerUnbilled = (enabled: boolean) =>
  useQuery({
    queryKey: [...LEDGER_KEY, 'unbilled'],
    enabled,
    queryFn: async () => (await ledgerUnbilledList()).data,
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

// --- Disputes, corrections and comments (phase 4) ---------------------------

/** Every change to a transaction touches balances, feeds and its detail page. */
const useInvalidateLedger = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: LEDGER_KEY });
};

/** Any member flags a transaction as wrong; it is never changed itself. */
export const useDisputeTransaction = () => {
  const invalidate = useInvalidateLedger();
  const { t } = useLanguage();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      (await ledgerTransactionsDisputeCreate({ path: { id }, body: { reason } })).data,
    onSuccess: () => {
      void invalidate();
      notifications.show({ message: t('ledger.disputeRaised'), color: 'green' });
    },
  });
};

export const useWithdrawDispute = () => {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async (id: string) => (await ledgerDisputesWithdrawCreate({ path: { id } })).data,
    onSuccess: () => void invalidate(),
  });
};

/** Keep the transaction as it is, with an explanation. */
export const useUpholdDispute = () => {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async ({ id, resolution }: { id: string; resolution: string }) =>
      (await ledgerDisputesUpholdCreate({ path: { id }, body: { resolution } })).data,
    onSuccess: () => void invalidate(),
  });
};

/** Undo what is left of a transaction with a new, linked one. */
export const useReverseTransaction = () => {
  const invalidate = useInvalidateLedger();
  const { t } = useLanguage();
  return useMutation({
    mutationFn: async ({ id, description }: { id: string; description: string }) =>
      (await ledgerTransactionsReverseCreate({ path: { id }, body: { description } })).data,
    onSuccess: () => {
      void invalidate();
      notifications.show({ message: t('ledger.reversed'), color: 'green' });
    },
  });
};

/** Undo part of a transaction: amounts per entry, as positive numbers. */
export const useCorrectTransaction = () => {
  const invalidate = useInvalidateLedger();
  const { t } = useLanguage();
  return useMutation({
    mutationFn: async ({
      id,
      description,
      lines,
    }: {
      id: string;
      description: string;
      lines: LedgerCorrectionLine[];
    }) =>
      (await ledgerTransactionsCorrectCreate({ path: { id }, body: { description, lines } })).data,
    onSuccess: () => {
      void invalidate();
      notifications.show({ message: t('ledger.correctionPosted'), color: 'green' });
    },
  });
};

export const useCommentOnTransaction = () => {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) =>
      (await ledgerTransactionsCommentsCreate({ path: { id }, body: { body } })).data,
    onSuccess: () => void invalidate(),
  });
};

// --- Shared expenses ----------------------------------------------------------

export type LedgerCostShareFilters = NonNullable<LedgerSplitsListData['query']>;

/** Splits, newest first. `waiting_for_me` lists those the viewer must answer. */
export const useLedgerCostShares = (filters: LedgerCostShareFilters = {}, enabled = true) =>
  useQuery({
    queryKey: [...LEDGER_KEY, 'splits', filters],
    enabled,
    queryFn: async () => (await ledgerSplitsList({ query: filters })).data,
  });

export const useLedgerCostShare = (id?: string) =>
  useQuery({
    queryKey: [...LEDGER_KEY, 'splits', 'detail', id],
    enabled: !!id,
    queryFn: async () => (await ledgerSplitsRetrieve({ path: { id: id! } })).data,
  });

/** Create a split, or change one (with `id`): everyone is asked again. */
export const useSaveCostShare = () => {
  const invalidate = useInvalidateLedger();
  const { t } = useLanguage();
  return useMutation({
    mutationFn: async ({
      id,
      receipts = [],
      ...body
    }: LedgerCostShareWrite & { id?: string; receipts?: File[] }) => {
      const saved = id
        ? (await ledgerSplitsUpdate({ path: { id }, body })).data
        : (await ledgerSplitsCreate({ body })).data;
      for (const file of receipts) {
        await ledgerSplitsReceiptsCreate({
          path: { id: saved.id },
          // The generated type describes the multipart file as a string.
          body: { file: file as unknown as string },
        });
      }
      return saved;
    },
    onSuccess: () => {
      void invalidate();
      notifications.show({ message: t('ledger.split.saved'), color: 'green' });
    },
  });
};

/** A participant accepts their share, or objects with a reason. */
export const useRespondToCostShare = () => {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async ({ id, accept, reason }: { id: string; accept: boolean; reason?: string }) =>
      accept
        ? (await ledgerSplitsAcceptCreate({ path: { id }, body: {} })).data
        : (await ledgerSplitsObjectCreate({ path: { id }, body: { reason } })).data,
    onSuccess: () => void invalidate(),
  });
};

export const useCancelCostShare = () => {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      (await ledgerSplitsCancelCreate({ path: { id }, body: { reason } })).data,
    onSuccess: () => void invalidate(),
  });
};

export const useAddCostShareReceipt = () => {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) =>
      (
        await ledgerSplitsReceiptsCreate({
          path: { id },
          body: { file: file as unknown as string },
        })
      ).data,
    onSuccess: () => void invalidate(),
  });
};

// --- Statistics, statements, report, categories and projects (phase 5) ------

/** Save a server-generated file (CSV) under `fileName`. */
const saveBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

export type LedgerStatsQuery = NonNullable<LedgerStatsRetrieveData['query']>;

/** Totals for a period, grouped by category, project, month, member or item. */
export const useLedgerStats = (query: LedgerStatsQuery) =>
  useQuery({
    queryKey: [...LEDGER_KEY, 'stats', query],
    queryFn: async () => (await ledgerStatsRetrieve({ query })).data,
    placeholderData: previous => previous,
  });

export interface LedgerPeriod {
  date_from: string;
  date_to: string;
}

/** An account statement for a period, with opening and closing balance. */
export const useLedgerStatement = (accountId: string | undefined, period: LedgerPeriod) =>
  useQuery({
    queryKey: [...LEDGER_KEY, 'accounts', accountId, 'statement', period],
    enabled: !!accountId,
    queryFn: async () =>
      (await ledgerAccountsStatementRetrieve({ path: { id: accountId! }, query: period })).data,
  });

export const useDownloadStatementCsv = () => {
  const { t } = useLanguage();
  return useMutation({
    mutationFn: async ({ accountId, period }: { accountId: string; period: LedgerPeriod }) => {
      const response = await ledgerAccountsStatementCsvRetrieve({
        path: { id: accountId },
        query: period,
        parseAs: 'blob',
      });
      saveBlob(response.data as Blob, `statement-${period.date_from}-${period.date_to}.csv`);
    },
    onError: () => notifications.show({ message: t('ledger.downloadFailed'), color: 'red' }),
  });
};

/** The treasurer's yearly overview; readable by every member. */
export const useLedgerAnnualReport = (year: number) =>
  useQuery({
    queryKey: [...LEDGER_KEY, 'report', year],
    queryFn: async () => (await ledgerReportsAnnualRetrieve({ query: { year } })).data,
  });

export const useDownloadAnnualReportCsv = () => {
  const { t } = useLanguage();
  return useMutation({
    mutationFn: async (year: number) => {
      const response = await ledgerReportsAnnualCsvRetrieve({
        query: { year },
        parseAs: 'blob',
      });
      saveBlob(response.data as Blob, `annual-report-${year}.csv`);
    },
    onError: () => notifications.show({ message: t('ledger.downloadFailed'), color: 'red' }),
  });
};

/** Every category, retired ones included (treasurer's manage page). */
export const useAllLedgerCategories = (enabled: boolean) =>
  useQuery({
    queryKey: [...LEDGER_KEY, 'categories', 'all'],
    enabled,
    queryFn: async () => (await ledgerCategoriesList({ query: { include_hidden: true } })).data,
  });

/** Every project, archived ones included (treasurer's manage page). */
export const useAllLedgerProjects = (enabled: boolean) =>
  useQuery({
    queryKey: [...LEDGER_KEY, 'projects', 'all'],
    enabled,
    queryFn: async () => (await ledgerProjectsList({ query: { include_hidden: true } })).data,
  });

/** Create a category, or change one (with `id`). Treasurer only. */
export const useSaveLedgerCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: Partial<LedgerCategoryWrite> & { id?: string }) =>
      id
        ? (await ledgerCategoriesPartialUpdate({ path: { id }, body })).data
        : (await ledgerCategoriesCreate({ body: body as LedgerCategoryWrite })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...LEDGER_KEY, 'categories'] }),
  });
};

/** Create a project, or change one (with `id`). Treasurer only. */
export const useSaveLedgerProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: Partial<LedgerProjectWrite> & { id?: string }) =>
      id
        ? (await ledgerProjectsPartialUpdate({ path: { id }, body })).data
        : (await ledgerProjectsCreate({ body: body as LedgerProjectWrite })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...LEDGER_KEY, 'projects'] }),
  });
};

// --- Hash chain, periods, exports and bank import (phase 6) ------------------

/** The chain head, whether a digest channel is set up, and recent digests. */
export const useLedgerChain = () =>
  useQuery({
    queryKey: [...LEDGER_KEY, 'chain'],
    queryFn: async () => (await ledgerChainRetrieve()).data,
  });

export const useDownloadChainCsv = () => {
  const { t } = useLanguage();
  return useMutation({
    mutationFn: async () => {
      const response = await ledgerChainExportRetrieve({ parseAs: 'blob' });
      saveBlob(response.data as Blob, 'ledger-chain.csv');
    },
    onError: () => notifications.show({ message: t('ledger.downloadFailed'), color: 'red' }),
  });
};

/** Closed bookkeeping periods, newest first. */
export const useLedgerPeriods = () =>
  useQuery({
    queryKey: [...LEDGER_KEY, 'periods'],
    queryFn: async () => (await ledgerPeriodsList()).data,
  });

export const useCloseLedgerPeriod = () => {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async (body: { starts_on: string; ends_on: string }) =>
      (await ledgerPeriodsCreate({ body })).data,
    onSuccess: () => void invalidate(),
  });
};

/** The journal (every member) or the DATEV file (treasurer) for a period.
 * A DATEV download fails with the accounts that still need a number. */
export const useDownloadLedgerExport = () =>
  useMutation({
    mutationFn: async ({
      format,
      period,
    }: {
      format: 'journal' | 'datev';
      period: LedgerPeriod;
    }) => {
      const download =
        format === 'datev' ? ledgerExportsDatevRetrieve : ledgerExportsJournalRetrieve;
      const response = await download({ query: period, parseAs: 'blob' });
      const name = format === 'datev' ? 'EXTF_bubble' : 'journal';
      saveBlob(response.data as Blob, `${name}-${period.date_from}-${period.date_to}.csv`);
    },
  });

const SYSTEM_TYPES: LedgerAccountTypeEnum[] = ['asset', 'income', 'expense', 'equity', 'suspense'];

/** Every account that is not a member's, for the DATEV number table. */
export const useLedgerSystemAccounts = (enabled: boolean) =>
  useQuery({
    queryKey: [...LEDGER_KEY, 'accounts', 'system'],
    enabled,
    queryFn: async () => {
      const pages = await Promise.all(
        SYSTEM_TYPES.map(type => ledgerAccountsList({ query: { type } })),
      );
      return pages.flatMap(page => page.data.results);
    },
  });

export const useSetDatevNumber = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, datev_number }: { id: string; datev_number: string }) =>
      (await ledgerAccountsDatevCreate({ path: { id }, body: { datev_number } })).data,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [...LEDGER_KEY, 'accounts', 'system'] }),
  });
};

/** Lines waiting for a decision, balances, and when the last file came in. */
export const useBankSummary = () =>
  useQuery({
    queryKey: [...BANK_KEY, 'summary'],
    queryFn: async () => (await ledgerBankLinesSummaryRetrieve()).data,
  });

export const useBankImports = () =>
  useQuery({
    queryKey: [...BANK_KEY, 'imports'],
    queryFn: async () => (await ledgerBankImportsList()).data,
  });

export type BankLineFilters = NonNullable<LedgerBankLinesListData['query']>;

export const useBankLines = (filters: BankLineFilters) =>
  useInfiniteQuery({
    queryKey: [...BANK_KEY, 'lines', filters],
    queryFn: async ({ pageParam }) =>
      (await ledgerBankLinesList({ query: { ...filters, page: pageParam } })).data,
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage?.next ? allPages.length + 1 : undefined),
  });

/** Entries a line could be linked to: same amount on the bank account, near its date. */
export const useBankLineCandidates = (id?: string) =>
  useQuery({
    queryKey: [...BANK_KEY, 'candidates', id],
    enabled: !!id,
    queryFn: async () => (await ledgerBankLinesCandidatesList({ path: { id: id! } })).data,
  });

export const useUploadBankStatement = () => {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async (file: File) =>
      (
        await ledgerBankImportsCreate({
          // The generated type describes the multipart file as a string.
          body: { file: file as unknown as string },
        })
      ).data,
    onSuccess: () => void invalidate(),
  });
};

export type BankLineDecision =
  | { action: 'book' | 'assign'; id: string; body: LedgerBankBook }
  | { action: 'link'; id: string; transaction: string }
  | { action: 'park' | 'ignore'; id: string; note: string }
  | { action: 'reopen'; id: string };

/** Book, assign, link, park, ignore or reopen one bank line. */
export const useDecideBankLine = () => {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async (decision: BankLineDecision) => {
      const path = { id: decision.id };
      switch (decision.action) {
        case 'book':
          return (await ledgerBankLinesBookCreate({ path, body: decision.body })).data;
        case 'assign':
          return (await ledgerBankLinesAssignCreate({ path, body: decision.body })).data;
        case 'link':
          return (
            await ledgerBankLinesLinkCreate({ path, body: { transaction: decision.transaction } })
          ).data;
        case 'park':
          return (await ledgerBankLinesParkCreate({ path, body: { note: decision.note } })).data;
        case 'ignore':
          return (await ledgerBankLinesIgnoreCreate({ path, body: { note: decision.note } })).data;
        case 'reopen':
          return (await ledgerBankLinesReopenCreate({ path })).data;
      }
    },
    onSuccess: () => void invalidate(),
  });
};
