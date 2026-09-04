import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toastSuccess, toastError } from '@/shared/ui/toast';
import { useMeQuery, useUpdateMeMutation } from '@/entities/user';
import { useUploadAvatarMutation } from '@/features/edit-profile';
import { resolveUploadUrl, validateImageFile } from '@/shared/lib/upload';
import { Avatar, AvatarImage, AvatarFallback } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { ImagePicker } from '@/shared/ui/image-picker';
import { Skeleton } from '@/shared/ui/skeleton';
import { TextInput } from '@/shared/ui/text-input';

export function ProfilePage() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useMeQuery();
  const updateMe = useUpdateMeMutation();
  const uploadAvatar = useUploadAvatarMutation();
  const [displayName, setDisplayName] = useState('');
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // Seed the input once the profile arrives, adjusted DURING RENDER rather
  // than in a useEffect — react-hooks/set-state-in-effect correctly rejects a
  // plain "if (data) setDisplayName(...)" effect here: the value is entirely
  // derivable from `data`, so no effect (no external system) is warranted.
  // `syncedDisplayName` starts at `undefined`, a value `data.display_name`
  // (`string | null`) can never equal, so the very first render with data
  // always seeds; after that it's keyed on the loaded value rather than
  // `data` identity, so a refetch that returns the same profile does not
  // wipe out what the user is in the middle of typing. Two setState calls
  // during render is the pattern React's own docs use for this ("Adjusting
  // state when a prop changes") — React re-renders immediately with the new
  // state before committing, so this never flashes stale content.
  const [syncedDisplayName, setSyncedDisplayName] = useState<string | null | undefined>(undefined);
  if (data && data.display_name !== syncedDisplayName) {
    setSyncedDisplayName(data.display_name);
    setDisplayName(data.display_name ?? '');
  }

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
            alt={data.display_name ?? data.username}
          />
          <AvatarFallback>
            {(data.display_name ?? data.username).slice(0, 2).toUpperCase()}
          </AvatarFallback>
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

      <p className="mt-4 text-sm text-muted-foreground">{data.username}</p>

      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          // `UpdateMeDto.display_name` is `@Length(1, 128)` when present — an
          // empty string 400s. Trim and omit the field entirely when blank
          // (a no-op that keeps the existing name) rather than sending ''.
          const trimmedDisplayName = displayName.trim();
          updateMe.mutate(
            trimmedDisplayName ? { display_name: trimmedDisplayName } : {},
            {
              onSuccess: () => toastSuccess(t('profile.saved')),
              onError: () => toastError(t('profile.saveFailed')),
            },
          );
        }}
      >
        <Field name="display_name" label={t('profile.displayName')}>
          {(a11y) => (
            <TextInput
              {...a11y}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          )}
        </Field>

        <Button type="submit" disabled={updateMe.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </section>
  );
}
