import { IsNumber, IsPositive, IsInt, Min, Max } from 'class-validator';

export class TransferDto {
  @IsNumber()
  @IsInt()
  @IsPositive()
  @Min(1)
  @Max(999999999)
  toCode: number;

  @IsNumber()
  @IsPositive()
  @Min(0.01)
  @Max(10000)
  value: number;
}
