import { IsString, Length, Matches } from 'class-validator';

export class SetCountExplanationDto {
  @IsString()
  @Length(1, 2000)
  @Matches(/\S/, { message: 'explanation must not be blank' })
  explanation: string;
}
