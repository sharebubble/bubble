import { getCSRFToken } from '@/lib/utils';
import { Image } from '../django';
import { client } from '../django/client.gen';

class ImagesAPI {
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

  // Create new image
  async createImage(data: {
    item: string;
    original: File | string;
    ordering?: number;
  }): Promise<Image> {
    const formData = new FormData();
    formData.append('item', data.item);
    formData.append('original', data.original as any);
    if (data.ordering !== undefined) {
      formData.append('ordering', data.ordering.toString());
    }

    return this.request<Image>('/api/images/', {
      method: 'POST',
      body: formData,
      // Don't set Content-Type header for FormData - let browser set it with boundary
    });
  }
  // Rotate an existing image 90° in the given direction
  async rotateImage(imageId: string, direction: 'left' | 'right'): Promise<Image> {
    return this.request<Image>(`/api/images/${imageId}/rotate/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction }),
    });
  }
}

export const imagesAPI = new ImagesAPI();
