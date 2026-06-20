import { getCSRFToken } from '@/lib/utils';
import { client } from '../django/client.gen';

export interface FeedLink {
  kind: 'item' | 'collection';
  feed_url: string;
  webcal_url: string;
  /** Whether the current user may rotate/revoke the link (owner/co-owner). */
  can_manage: boolean;
  created_at: string;
  updated_at: string;
}

export interface PersonalCalendar {
  kind: 'user';
  caldav_url: string;
  created_at: string;
  updated_at: string;
}

type Method = 'GET' | 'POST' | 'DELETE';

async function request<T>(endpoint: string, method: Method = 'GET'): Promise<T | undefined> {
  const headers: HeadersInit = {};
  if (method !== 'GET') {
    const csrfToken = getCSRFToken();
    if (csrfToken) {
      headers['X-CSRFToken'] = csrfToken;
    }
  }

  const response = await fetch(`${client.getConfig().baseUrl}${endpoint}`, {
    method,
    credentials: 'include',
    headers,
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }
  if (response.status === 204) {
    return undefined;
  }
  return response.json();
}

/**
 * Calendar (CalDAV / iCalendar) sharing links.
 *
 * These hit small custom DRF endpoints (see backend `bubble.caldav`) rather
 * than the generated SDK, mirroring the existing `imagesAPI` pattern.
 */
export const calendarAPI = {
  // --- per-item public feed ---
  getItemLink: (itemId: string) => request<FeedLink>(`/api/items/${itemId}/calendar-link/`, 'GET'),
  regenerateItemLink: (itemId: string) =>
    request<FeedLink>(`/api/items/${itemId}/calendar-link/`, 'POST'),
  revokeItemLink: (itemId: string) =>
    request<void>(`/api/items/${itemId}/calendar-link/`, 'DELETE'),

  // --- per-collection public feed ---
  getCollectionLink: (collectionId: string) =>
    request<FeedLink>(`/api/collections/${collectionId}/calendar-link/`, 'GET'),
  regenerateCollectionLink: (collectionId: string) =>
    request<FeedLink>(`/api/collections/${collectionId}/calendar-link/`, 'POST'),
  revokeCollectionLink: (collectionId: string) =>
    request<void>(`/api/collections/${collectionId}/calendar-link/`, 'DELETE'),

  // --- personal read-write CalDAV ---
  getMyCalendar: () => request<PersonalCalendar>(`/api/my-calendar/`, 'GET'),
  regenerateMyCalendar: () => request<PersonalCalendar>(`/api/my-calendar/`, 'POST'),
  revokeMyCalendar: () => request<void>(`/api/my-calendar/`, 'DELETE'),
};
