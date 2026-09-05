import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/shared/ui/toast';
import { useMeQuery } from '@/entities/user';
import { useUploadAvatarMutation } from '@/features/edit-profile';
import { resolveUploadUrl, validateImageFile } from '@/shared/lib/upload';
import { Avatar, AvatarImage, AvatarFallback } from '@/shared/ui/avatar';
import { ImagePicker } from '@/shared/ui/image-picker';
import { Skeleton } from '@/shared/ui/skeleton';

export function ProfilePage() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useMeQuery();
  const uploadAvatar = useUploadAvatarMutation();
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  if (isPending) {
    return (
      <div data-testid="profile-skeleton" className="flex flex-col gap-4">
        <Skeleton className="h-20 w-20 rounded-full" />
        <Skeleton className="h-10 w-64" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p role="alert" className="text-destructive">
        {t('common.somethingWentWrong')}
      </p>
    );
  }

  return (
    <section className="max-w-md">
      <h1 className="text-2xl font-semibold">{t('profile.title')}</h1>

      <div className="mt-6 flex items-center gap-4">
        {/* `Avatar` is a Radix compound component, not `<Avatar src alt/>`.
            `resolveUploadUrl` is load-bearing: the API returns a path rooted at
            ITS origin (`/uploads/avatars/…`), and in dev the frontend is served
            from a different port — a bare relative src would 404 against the
            Vite dev server. */}
        <Avatar className="size-20">
          <AvatarImage
            src={data.avatar_url ? resolveUploadUrl(data.avatar_url) : undefined}
            alt={data.display_name}
          />
          <AvatarFallback>{data.display_name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        {/* `ImagePicker` is CONTROLLED — `value: File | null`, `onChange`,
            `title`. Hold the picked File in state and fire the upload from
            onChange; clear it once the mutation lands so the preview falls
            back to the persisted avatar. */}
        <ImagePicker
          title={t('profile.changeAvatar')}
          value={pendingAvatar}
          onChange={(file) => {
            // Ignore a new pick while one is in flight. Two concurrent uploads
            // share this mutation, and whichever response lands LAST wins in
            // setQueryData — so correcting a mistaken upload with a faster
            // second one can persist the first, wrong avatar.
            if (uploadAvatar.isPending) return;
            setPendingAvatar(file);
            if (!file) return;
            // Validate client-side before spending an upload round trip. The
            // backend enforces the same cap independently — this is UX, not
            // security.
            const problem = validateImageFile(file);
            if (problem) {
              setAvatarError(problem === 'size' ? 'profile.avatarTooLarge' : 'profile.avatarWrongType');
              setPendingAvatar(null);
              return;
            }
            setAvatarError(null);
            uploadAvatar.mutate(file, {
              // Without onError a failed upload is indistinguishable from a
              // successful one: the picker just reverts and nothing tells the
              // user why.
              onError: () => toastError(t('profile.avatarUploadFailed')),
              onSettled: () => setPendingAvatar(null),
            });
          }}
          error={avatarError ?? undefined}
        />
      </div>

      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('profile.name')}</dt>
        <dd>{data.display_name}</dd>

        <dt className="text-muted-foreground">{t('profile.login')}</dt>
        <dd>{data.username}</dd>

        <dt className="text-muted-foreground">{t('profile.role')}</dt>
        <dd>{t(`profile.roles.${data.role}`)}</dd>
      </dl>
    </section>
  );
}
