import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import {
  fetchCoinValuationSuggestion,
  fetchItemCoinSummary,
  fetchItemCoinValuations,
  saveCoinValuation,
  type CoinValuationInput,
} from '@/services/custom/coins';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/** Query key for everything hanging off one item's coin track record. */
const coinKey = (itemId: string | undefined) => ['coins', itemId] as const;

/** The coin track record of an item — public to everyone who can see the item. */
export const useItemCoinValuations = (itemId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: [...coinKey(itemId), 'list'],
    queryFn: () => fetchItemCoinValuations(itemId!),
    enabled: Boolean(itemId) && enabled,
  });

/** Totals of an item's coin track record. */
export const useItemCoinSummary = (itemId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: [...coinKey(itemId), 'summary'],
    queryFn: () => fetchItemCoinSummary(itemId!),
    enabled: Boolean(itemId) && enabled,
  });

/**
 * The value the current user last picked for this item, used to open the
 * slider where they left it instead of at zero.
 */
export const useCoinValuationSuggestion = (itemId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: [...coinKey(itemId), 'suggestion'],
    queryFn: () => fetchCoinValuationSuggestion(itemId!),
    enabled: Boolean(itemId) && enabled,
    // Always reflect the latest saved value when the dialog reopens.
    staleTime: 0,
  });

/** Record (or correct) what a settled transaction was worth in coins. */
export const useSaveCoinValuation = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();

  return useMutation({
    mutationFn: (input: CoinValuationInput) => saveCoinValuation(input),
    onSuccess: valuation => {
      queryClient.invalidateQueries({ queryKey: coinKey(valuation.item) });
      // Bookings carry the valuation and the eligibility flag that drives the
      // prompt, so both the list and the detail view need refreshing.
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast({ title: t('coins.saved') });
    },
    onError: () => {
      toast({ title: t('coins.saveFailed'), variant: 'destructive' });
    },
  });
};
