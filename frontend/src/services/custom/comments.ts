import { getCSRFToken } from '@/lib/utils';
import { client } from '../django/client.gen';

/** A comment/rating left by a user on an item. */
export interface ItemComment {
  id: string;
  item: string;
  user: {
    id: string;
    username: string;
    name: string;
  };
  body: string;
  rating: number | null;
  created_at: string;
  updated_at: string;
}

interface PaginatedComments {
  count: number;
  next: string | null;
  previous: string | null;
  results: ItemComment[];
}

export interface CreateCommentInput {
  item: string;
  body: string;
  rating?: number | null;
}

/**
 * Hand-written client for the comments endpoints.
 *
 * The generated SDK in `src/services/django` is regenerated from the backend
 * OpenAPI schema; until that runs this thin wrapper mirrors the pattern used by
 * `services/custom/images.ts` so the feature works against the live API.
 */
class CommentsAPI {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const headers: HeadersInit = {
      ...options?.headers,
    };

    const method = options?.method?.toUpperCase();
    if (method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrfToken = getCSRFToken();
      if (csrfToken) {
        headers['X-CSRFToken'] = csrfToken;
      }
    }

    const response = await fetch(`${client.getConfig().baseUrl}${endpoint}`, {
      credentials: 'include',
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    if (response.status === 204) {
      return Promise.resolve(undefined as T);
    }

    return response.json();
  }

  /**
   * List every comment for a single item, newest first.
   *
   * The endpoint is paginated (DRF PageNumberPagination), so follow the
   * `next` links until exhausted — otherwise the popup would only ever show
   * the first page while the item summary advertises the full comment count.
   */
  async listForItem(itemId: string): Promise<ItemComment[]> {
    const all: ItemComment[] = [];
    let endpoint: string | null = `/api/comments/?item=${encodeURIComponent(itemId)}`;

    while (endpoint) {
      const data: PaginatedComments | ItemComment[] = await this.request<
        PaginatedComments | ItemComment[]
      >(endpoint);

      if (Array.isArray(data)) {
        all.push(...data);
        break;
      }

      all.push(...(data.results ?? []));
      // `next` is an absolute URL; reduce it to a path the client can resolve.
      endpoint = data.next ? new URL(data.next).pathname + new URL(data.next).search : null;
    }

    return all;
  }

  /** Create a new comment (optionally with a rating) for an item. */
  async create(input: CreateCommentInput): Promise<ItemComment> {
    return this.request<ItemComment>('/api/comments/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  /** Delete a comment by id. */
  async remove(commentId: string): Promise<void> {
    return this.request<void>(`/api/comments/${commentId}/`, {
      method: 'DELETE',
    });
  }
}

export const commentsAPI = new CommentsAPI();
