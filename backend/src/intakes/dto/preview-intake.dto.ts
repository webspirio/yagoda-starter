import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { CreateIntakeItemDto } from './create-intake.dto';

/**
 * `CreateIntakeDto` MINUS `code` — everything the server needs to COMPUTE a
 * receipt, and nothing it needs only to RECORD one. The reception screen shows
 * net weight, price, bonus and the line and document amounts live as the
 * operator types, and §2.4/§2.8/§2.9 make the server the only place those may
 * be computed, so the client asks for the numbers without asking for a
 * document. The receipt number is irrelevant to that answer: nothing about
 * `code` changes a weight or an amount.
 *
 * The three fields are RESTATED rather than inherited or `OmitType`d:
 * `@nestjs/mapped-types` is not a dependency, and making `CreateIntakeDto`
 * extend this class would have the two files import each other. The item and
 * tare shapes — where every rule lives — are the same classes, not copies.
 */
export class PreviewIntakeDto {
  /** Owner only. An operator's point comes from their token and a value naming
   *  another point is refused by `assertOwnsPoint`. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsUUID()
  supplier_id: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateIntakeItemDto)
  items: CreateIntakeItemDto[];
}
