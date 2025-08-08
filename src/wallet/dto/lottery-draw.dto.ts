import { IsNumber, IsPositive } from 'class-validator';

export class LotteryDrawDto {
  @IsNumber()
  @IsPositive()
  valorPorEntrada: number;
}
