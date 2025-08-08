import { IsString, IsNotEmpty } from 'class-validator';

export class CancelTransactionDto {
  @IsString()
  @IsNotEmpty()
  transactionId: string;
}
