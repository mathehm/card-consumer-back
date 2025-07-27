enum TransactionType {
  Credit = 'credit',
  Debit = 'debit',
  TransferOut = 'transfer_out',
  TransferIn = 'transfer_in',
}

export class Transaction {
  id?: string;  // ID nativo do Firestore
  value: number;
  type: TransactionType;
  date: string;
  description?: string;
  relatedWalletCode?: number;
  transferId?: string;
  
  // Campos para cancelamento
  status?: 'active' | 'cancelled';
  cancelledAt?: Date;
  cancellationReason?: string;
}
