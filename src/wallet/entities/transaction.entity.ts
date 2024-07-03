enum TransactionType {
  Credit = 'credit',
  Debit = 'debit',
}

export class Transaction {
  id: number;
  value: number;
  type: TransactionType;
  date: string;
}
