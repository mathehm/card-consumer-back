import { IsString, IsNumber, IsPositive, Min, Max, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateProductDto {
  @IsString({ message: 'Nome do produto deve ser uma string' })
  @IsNotEmpty({ message: 'Nome do produto é obrigatório' })
  @MaxLength(100, { message: 'Nome do produto deve ter no máximo 100 caracteres' })
  name: string;

  @IsString({ message: 'Categoria deve ser uma string' })
  @IsNotEmpty({ message: 'Categoria é obrigatória' })
  @MaxLength(50, { message: 'Categoria deve ter no máximo 50 caracteres' })
  category: string;

  @IsNumber({}, { message: 'Preço deve ser um número' })
  @IsPositive({ message: 'Preço deve ser positivo' })
  @Min(0.01, { message: 'Preço mínimo é R$ 0,01' })
  @Max(10000, { message: 'Preço máximo é R$ 10.000,00' })
  currentPrice: number;
}
