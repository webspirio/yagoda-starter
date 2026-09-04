import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  display_name?: string;

  @IsOptional()
  @IsIn(['en'])
  language_code?: string;
}
