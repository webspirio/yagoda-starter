import { IsOptional, IsUUID } from 'class-validator';

/** An operator's point comes from their token and this is ignored; an owner
 *  must name a point, since they have none of their own. */
export class CurrentShiftQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;
}
