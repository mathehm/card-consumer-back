import { IsNumber, IsPositive, IsInt, Min, Max } from 'class-validator';

export class TransferDto {
  @IsNumber({}, { message: 'Código da carteira destino deve ser um número' })
  @IsInt({ message: 'Código da carteira destino deve ser um número inteiro' })
  @IsPositive({ message: 'Código da carteira destino deve ser positivo' })
  @Min(1, { message: 'Código da carteira destino deve ser pelo menos 1' })
  @Max(999999999, { message: 'Código da carteira destino não pode exceder 999999999' })
  toCode: number;

  @IsNumber({}, { message: 'Valor da transferência deve ser um número' })
  @IsPositive({ message: 'Valor da transferência deve ser positivo' })
  @Min(0.01, { message: 'Valor mínimo para transferência é R$ 0,01' })
  @Max(100000, { message: 'Valor máximo para transferência é R$ 100.000,00' })
  value: number;
}
