// Query params that put the home route ("/") into "browse/search" mode instead
// of the mobile start page. Shared by the RootRoute dispatcher (App.tsx) and the
// mobile bottom navigation so both agree on what counts as a browse intent.
const BROWSE_PARAM_KEYS = [
  'browse',
  'search',
  'type',
  'category',
  'owner',
  'collection',
  'availability',
  'minPrice',
  'maxPrice',
  'free',
  'conditions',
  'sortField',
  'sortDir',
  'scope',
  'page',
];

export const hasBrowseParams = (search: string): boolean => {
  const params = new URLSearchParams(search);
  return BROWSE_PARAM_KEYS.some(key => params.has(key));
};
