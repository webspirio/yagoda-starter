import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { TareType } from '../tare-types/tare-type.entity';
import { ReweighItem } from './reweigh-item.entity';

/**
 * §8.1's «115 Чешок × 1,20 кг» — the breakdown behind the line's snapshotted
 * `tare_weight_kg`.
 *
 * WHY THE BREAKDOWN IS KEPT AND NOT JUST THE TOTAL: §8.2's reconciliation is a
 * dispute screen. When the point says 800 and the base says 790, «115 ящиків по
 * 1,20» is the line of the argument that gets checked, and a bare `138,00` is
 * not checkable.
 *
 * NOT RESTRICTED TO THE `is_crate` TYPE. Pallets and Чешки are both in play
 * here; `is_crate` is about deposits (§6.1), not about weight.
 *
 * §2.6 STILL HOLDS: these counts and `crate_returns` never add up into one
 * number. Nothing here joins to the crate tables.
 */
@Entity('reweigh_item_tare_types')
@Check('CHK_reweigh_item_tare_types_units', `"units" > 0`)
export class ReweighItemTareType {
  @PrimaryColumn({ type: 'uuid' })
  item_id: string;

  @ManyToOne(() => ReweighItem, (item) => item.tare, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item?: ReweighItem;

  @PrimaryColumn({ type: 'uuid' })
  tare_type_id: string;

  @ManyToOne(() => TareType, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tare_type_id' })
  tare_type?: TareType;

  @Column({ type: 'int' })
  units: number;
}
