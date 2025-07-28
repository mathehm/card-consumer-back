import { IsString, IsNumber, IsPositive, Min, IsNotEmpty, IsArray, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class DebitItemDto {
  @IsString({ message: 'ID do produto deve ser uma string' })
  @IsNotEmpty({ message: 'ID do produto é obrigatório' })
  productId: string;

  @IsNumber({}, { message: 'Quantidade deve ser um número' })
  @IsPositive({ message: 'Quantidade deve ser positiva' })
  @Min(1, { message: 'Quantidade mínima é 1' })
  quantity: number;
}

export class DebitDto {
  @IsOptional()
  @IsArray({ message: 'Items deve ser um array' })
  @ValidateNested({ each: true })
  @Type(() => DebitItemDto)
  items?: DebitItemDto[];

  @IsOptional()
  @IsNumber({}, { message: 'Valor deve ser um número' })
  @IsPositive({ message: 'Valor deve ser positivo' })
  @Min(0.01, { message: 'Valor mínimo é R$ 0,01' })
  value?: number;
}
