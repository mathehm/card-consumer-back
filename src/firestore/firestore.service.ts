import { Injectable, Inject } from '@nestjs/common';
import { Firestore } from '@google-cloud/firestore';
import { FieldValue } from '@google-cloud/firestore';

@Injectable()
export class FirestoreService {
  constructor(@Inject(Firestore) private readonly firestore: Firestore) { }

  async registerWallet(walletData: any): Promise<any> {
    const userRef = this.firestore.collection('users').doc();
    await userRef.set(walletData.user);

    const walletRef = this.firestore.collection('wallets').doc();
    await walletRef.set({
      code: walletData.code,
      balance: walletData.balance || 0,
      userId: userRef.id,
    });

    return { message: 'Carteira criada com sucesso' };
  }

  async getWalletByCode(walletCode: number): Promise<any> {
    const walletRef = this.firestore
      .collection('wallets')
      .where('code', '==', walletCode)
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
      .where('walletCode', '==', walletCode);
    const transactionsSnapshot = await transactionsRef.get();
    const transactions = transactionsSnapshot.docs.map((doc) => doc.data());

    return {
      balance: walletData.balance,
      user: userData,
      transactions,
    };
  }

  async deleteWallet(walletCode: number): Promise<any> {
    const walletRef = this.firestore
      .collection('wallets')
      .where('code', '==', walletCode)
      .limit(1);
    const walletSnapshot = await walletRef.get();

    if (walletSnapshot.empty) {
      throw new Error('Carteira não encontrada');
    }

    const walletDoc = walletSnapshot.docs[0];
    await walletDoc.ref.delete();

    return { message: 'Carteira cancelada com sucesso' };
  }

  async credit(walletCode: number, creditValue: number): Promise<any> {
    const walletRef = this.firestore
      .collection('wallets')
      .where('code', '==', walletCode)
      .limit(1);
    const walletSnapshot = await walletRef.get();

    if (walletSnapshot.empty) {
      throw new Error('Carteira não encontrada');
    }

    const walletDoc = walletSnapshot.docs[0];
    const walletData = walletDoc.data();

    const newBalance = walletData.balance + creditValue;
    await walletDoc.ref.update({ balance: newBalance });

    await this.firestore.collection('transactions').add({
      walletCode,
      value: creditValue,
      type: 'credit',
      date: FieldValue.serverTimestamp(),
    });

    return { message: 'Crédito adicionado com sucesso' };
  }

  async debit(walletCode: number, debitValue: number): Promise<any> {
    const walletRef = this.firestore
      .collection('wallets')
      .where('code', '==', walletCode)
      .limit(1);
    const walletSnapshot = await walletRef.get();

    if (walletSnapshot.empty) {
      throw new Error('Carteira não encontrada');
    }

    const walletDoc = walletSnapshot.docs[0];
    const walletData = walletDoc.data();

    if (walletData.balance < debitValue) {
      throw new Error('Saldo insuficiente');
    }

    const newBalance = walletData.balance - debitValue;
    await walletDoc.ref.update({ balance: newBalance });

    await this.firestore.collection('transactions').add({
      walletCode,
      value: debitValue,
      type: 'debit',
      date: FieldValue.serverTimestamp(),
    });

    return { message: 'Débito realizado com sucesso' };
  }
}
