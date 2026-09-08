import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { TareType } from '../tare-types/tare-type.entity';
import { IntakeItem } from './intake-item.entity';

/**
 * How many of which tare a line was delivered in — the weight that comes OFF
 * the scale.
 *
 * §2.6 — THIS IS NOT CRATE OWNERSHIP. «Ящики В КВИТАНЦІЇ (вага, що знімається)
 * і ящики НА РУКАХ (майно, crate_issuances) ніде не складаються в одне»: a
 * person can arrive with berries in 12 crates and take 20 crates home the same
 * day, and the two numbers are different documents on different screens. When
 * `crate_issuances` lands, nothing here joins to it.
 *
 * COMPOSITE PRIMARY KEY `(item_id, tare_type_id)` — so a tare type appears at
 * most once per line, and «12 × Чешка» is a `units` count rather than twelve
 * rows.
 */
@Entity('intake_item_tare_types')
@Check('CHK_intake_item_tare_types_units', `"units" > 0`)
export class IntakeItemTareType {
  @PrimaryColumn({ type: 'uuid' })
  item_id: string;

  @ManyToOne(() => IntakeItem, (item) => item.tare, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item?: IntakeItem;

  @PrimaryColumn({ type: 'uuid' })
  tare_type_id: string;

  @ManyToOne(() => TareType, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tare_type_id' })
  tare_type?: TareType;

  @Column({ type: 'int' })
  units: number;
}
