enum TransactionType {
  Credit = 'credit',
  Debit = 'debit',
  TransferOut = 'transfer_out',
  TransferIn = 'transfer_in',
}

export class Transaction {
  id: number;
  value: number;
  type: TransactionType;
  date: string;
  description?: string;
  relatedWalletCode?: number;
  transferId?: string;
}
