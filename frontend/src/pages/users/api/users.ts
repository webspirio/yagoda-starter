import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type {
  AdminUser,
  CreateUserInput,
  Paginated,
  SetPasswordInput,
  UpdateUserInput,
} from '../model/user';

/** Owner-facing registry, so inactive users are asked for too. */
export function useUsersQuery() {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: async (): Promise<Paginated<AdminUser>> => {
      const { data } = await httpClient.get<Paginated<AdminUser>>('/users', {
        params: { include_inactive: true },
      });
      return data;
    },
    staleTime: STALE.list,
  });
}

export function useCreateUserMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateUserInput): Promise<AdminUser> => {
      const { data } = await httpClient.post<AdminUser>('/users', input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

export function useUpdateUserMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateUserInput): Promise<AdminUser> => {
      const { data } = await httpClient.patch<AdminUser>(`/users/${id}`, body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

/** Password reset is its OWN endpoint (`PUT /users/:id/password`), never PATCH. */
export function useSetPasswordMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, password }: SetPasswordInput): Promise<void> => {
      await httpClient.put(`/users/${id}/password`, { password });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.users }),
  });
}
