/**
 * Search facet endpoints.
 *
 * Thin typed wrappers around the public-items facet endpoints that power the
 * header search popup (owner and category facets). They live here — rather than
 * in the generated SDK — because the SDK can only be regenerated against a live
 * backend (`npm run types:openapi`); a future regeneration will fold these
 * operations into `src/services/django` and these helpers can be retired.
 *
 * They reuse the shared, pre-configured `client` so credentials, CSRF and the
 * Accept-Language header are applied exactly like every generated SDK call.
 */

import { client } from '../django/client.gen';

/** A user who owns at least one shared (published and visible) item. */
export interface ItemOwner {
  id: string;
  username: string;
  name: string;
  item_count: number;
}

/** A category together with the number of shared items it contains. */
export interface CategoryFacet {
  category: string;
  count: number;
}

/** Fetch every owner of visible published items, with their item counts. */
export const fetchItemOwners = async (): Promise<ItemOwner[]> => {
  const { data } = await client.get<{ 200: ItemOwner[] }>({
    url: '/api/public-items/owners/',
  });
  return data ?? [];
};

/** Fetch every category present among visible published items, with counts. */
export const fetchCategoryFacets = async (): Promise<CategoryFacet[]> => {
  const { data } = await client.get<{ 200: CategoryFacet[] }>({
    url: '/api/public-items/categories/',
  });
  return data ?? [];
};
