import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { MediaPurpose } from './media.constants';

/**
 * Metadata for every uploaded image (see the design spec). Files live on disk
 * (uploads volume); this row is the lifecycle/audit record that enables
 * delete-on-replace and a future orphan-cleanup sweep. Entities keep their own
 * denormalized URL column for fast, join-free reads — this table is never on
 * the image read path.
 */
@Entity('media_files')
export class MediaFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** On-disk filename `<uuid>.<ext>` — unique. */
  @Column({ type: 'varchar', unique: true })
  storage_key: string;

  /** Public, prefix-rooted URL (`/uploads/<storage_key>`). */
  @Column({ type: 'varchar' })
  url: string;

  @Column({ type: 'varchar' })
  kind: string;

  @Column({ type: 'int' })
  size_bytes: number;

  @Column({ type: 'enum', enum: MediaPurpose, enumName: 'media_purpose' })
  purpose: MediaPurpose;

  /** Uploader; null for uploads made before an account exists. */
  @Column({ type: 'uuid', nullable: true })
  uploaded_by: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
