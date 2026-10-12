import { IsString, Length, Matches } from 'class-validator';

export class SetCountOperatorNoteDto {
  @IsString()
  @Length(1, 2000)
  @Matches(/\S/, { message: 'operator_note must not be blank' })
  operator_note: string;
}
