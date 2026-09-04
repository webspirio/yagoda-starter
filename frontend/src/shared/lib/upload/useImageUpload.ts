import { useState } from 'react';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';

export interface ImageUploadResponse {
  id?: string;
  url: string;
}

export interface UseImageUploadOptions {
  /** Extra headers computed per upload. */
  getHeaders?: () => Record<string, string>;
}

export interface ImageUpload {
  mutation: UseMutationResult<ImageUploadResponse, unknown, File>;
  /** 0–100 while a file is in flight. */
  progress: number;
}

/** Generic multipart image upload with live progress. */
export function useImageUpload(endpoint: string, options?: UseImageUploadOptions): ImageUpload {
  const [progress, setProgress] = useState(0);

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const { data } = await httpClient.post<ImageUploadResponse>(endpoint, form, {
        headers: options?.getHeaders?.(),
        onUploadProgress: (event) => {
          setProgress(event.total ? Math.round((event.loaded / event.total) * 100) : 0);
        },
      });
      return data;
    },
    onMutate: () => setProgress(0),
  });

  return { mutation, progress };
}
