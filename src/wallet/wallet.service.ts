import { Inject, Injectable } from '@nestjs/common';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { FieldValue, Firestore } from '@google-cloud/firestore';

@Injectable()
export class WalletService {
  constructor(@Inject(Firestore) private readonly firestore: Firestore) { }

  async create(createWalletDto: CreateWalletDto): Promise<any> {
    const userRef = this.firestore.collection('users').doc();
    await userRef.set(createWalletDto.user);

    const walletRef = this.firestore.collection('wallets').doc();
    await walletRef.set({
      code: createWalletDto.code,
      balance: createWalletDto.balance || 0,
      userId: userRef.id,
    });

    return { message: 'Carteira criada com sucesso' };
  }

  async findOne(code: number): Promise<any> {
    const walletRef = this.firestore
      .collection('wallets')
      .where('code', '==', code)
      .limit(1);

    const walletSnapshot = await walletRef.get();

    if (walletSnapshot.empty) {
      throw new Error('Carteira não encontrada');
    }

    const walletDoc = walletSnapshot.docs[0];
    const walletData = walletDoc.data();

    const userRef = this.firestore.collection('users').doc(walletData.userId);
    const userSnapshot = await userRef.get();

    if (!userSnapshot.exists) {
      throw new Error('Usuário não encontrado');
    }

    const userData = userSnapshot.data();

    const transactionsRef = this.firestore
      .collection('transactions')
      .where('code', '==', code);
    const transactionsSnapshot = await transactionsRef.get();
    const transactions = transactionsSnapshot.docs.map((doc) => doc.data());

    return {
      balance: walletData.balance,
      user: userData,
      transactions,
    };
  }

  async remove(code: number): Promise<any> {
    const walletRef = this.firestore
      .collection('wallets')
      .where('code', '==', code)
      .limit(1);
    const walletSnapshot = await walletRef.get();

    if (walletSnapshot.empty) {
      throw new Error('Carteira não encontrada');
    }

    const walletDoc = walletSnapshot.docs[0];
    await walletDoc.ref.delete();

    return { message: 'Carteira cancelada com sucesso' };
  }

  async credit(code: number, value: number): Promise<any> {
    const walletRef = this.firestore
      .collection('wallets')
      .where('code', '==', code)
      .limit(1);
    const walletSnapshot = await walletRef.get();

    if (walletSnapshot.empty) {
      throw new Error('Carteira não encontrada');
    }

    const walletDoc = walletSnapshot.docs[0];
    const walletData = walletDoc.data();

    const newBalance = walletData.balance + value;
    await walletDoc.ref.update({ balance: newBalance });

    await this.firestore.collection('transactions').add({
      code,
      value: value,
      type: 'credit',
      date: FieldValue.serverTimestamp(),
    });

    return { message: 'Crédito adicionado com sucesso' };
  }

  async debit(code: number, value: number): Promise<any> {
    const walletRef = this.firestore
      .collection('wallets')
      .where('code', '==', code)
      .limit(1);
    const walletSnapshot = await walletRef.get();

    if (walletSnapshot.empty) {
      throw new Error('Carteira não encontrada');
    }

    const walletDoc = walletSnapshot.docs[0];
    const walletData = walletDoc.data();

    if (walletData.balance < value) {
      throw new Error('Saldo insuficiente');
    }

    const newBalance = walletData.balance - value;
    await walletDoc.ref.update({ balance: newBalance });

    await this.firestore.collection('transactions').add({
      code,
      value: value,
      type: 'debit',
      date: FieldValue.serverTimestamp(),
    });

    return { message: 'Débito realizado com sucesso' };
  }
}
