/**
 * Search facets endpoint.
 *
 * Thin typed wrapper around the public-items `facets` endpoint that powers the
 * header search popup. It returns every facet (category, collection,
 * availability, owner) cross-filtered by the *other* active selections, so the
 * options and counts on offer update as filters are picked.
 *
 * It lives here — rather than in the generated SDK — because the SDK can only be
 * regenerated against a live backend (`npm run types:openapi`); a future
 * regeneration will fold this operation into `src/services/django` and this
 * helper can be retired. It reuses the shared, pre-configured `client` so
 * credentials, CSRF and the Accept-Language header are applied exactly like
 * every generated SDK call.
 */

import { client } from '../django/client.gen';

/** A category and the number of matching shared items. */
export interface CategoryFacet {
  category: string;
  count: number;
}

/** A collection (with its owner) and the number of matching items it contains. */
export interface CollectionFacet {
  id: string;
  name: string;
  owner: string;
  count: number;
}

/** An owner and the number of their matching shared items. */
export interface OwnerFacet {
  id: string;
  username: string;
  name: string;
  count: number;
}

/** An availability value (`available` | `rented` | `sold`) and its item count. */
export interface AvailabilityFacet {
  value: string;
  count: number;
}

/** A type value (`rent` | `buy` | `wanted`) and its item count. */
export interface TypeFacet {
  value: string;
  count: number;
}

/** The complete set of search facets, each excluding its own active filter. */
export interface SearchFacets {
  types: TypeFacet[];
  categories: CategoryFacet[];
  collections: CollectionFacet[];
  availability: AvailabilityFacet[];
  owners: OwnerFacet[];
}

/** The currently active filter selection, used to cross-filter the facets. */
export interface SearchFacetParams {
  type?: string;
  category?: string;
  collection?: string;
  owner?: string;
  availability?: string;
  search?: string;
}

const EMPTY_FACETS: SearchFacets = {
  types: [],
  categories: [],
  collections: [],
  availability: [],
  owners: [],
};

/** Fetch all search facets cross-filtered by the given active selection. */
export const fetchSearchFacets = async (params: SearchFacetParams): Promise<SearchFacets> => {
  const { data } = await client.get<{ 200: SearchFacets }>({
    url: '/api/public-items/facets/',
    query: {
      type: params.type,
      category: params.category,
      collection: params.collection,
      owner: params.owner,
      availability: params.availability,
      search: params.search,
    },
  });
  return data ?? EMPTY_FACETS;
};
