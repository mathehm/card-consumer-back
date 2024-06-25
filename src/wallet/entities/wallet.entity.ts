import { User } from './user.entity';
import { Transaction } from './transaction.entity';

export class Wallet {
  code: number;
  balance?: number;
  user: User;
  transactions?: Transaction[];
}
