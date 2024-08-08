enum TransactionType {
  Credit = 'credit',
  Debit = 'debit',
}

interface Product {
  id: number;
  name: string;
  price: number;
  quantity: number;
  category: string;
}

export class Transaction {
  id: number;
  value: number;
  type: TransactionType;
  date: string;
  products: Product[];
}
