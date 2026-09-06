import { IsString, IsUUID, Length } from 'class-validator';

export class CreateProductGradeDto {
  /** Required, and the only time a grade's parent is ever set. */
  @IsUUID()
  product_id: string;

  @IsString()
  @Length(1, 128)
  name: string;
}
