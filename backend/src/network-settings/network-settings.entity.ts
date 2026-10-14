import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** The network's one settings row — see the migration for why `id` is a boolean. */
@Entity('network_settings')
export class NetworkSettings {
  @PrimaryColumn({ type: 'boolean', default: true })
  id: boolean;

  /** Already wrapped onto the receipt's seven note lines; `null` prints no note. */
  @Column({ type: 'text', nullable: true })
  receipt_note: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
