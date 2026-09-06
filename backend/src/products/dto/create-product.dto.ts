import { IsString, Length } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @Length(1, 128)
  name: string;
}
