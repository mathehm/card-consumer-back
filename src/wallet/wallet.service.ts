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
    const balance = createWalletDto.balance || 0;

    await walletRef.set({
      code: createWalletDto.code,
      balance: balance,
      userId: userRef.id,
    });

    if (balance > 0) {
      await this.firestore.collection('transactions').add({
        code: createWalletDto.code,
        value: balance,
        type: 'credit',
        date: FieldValue.serverTimestamp(),
      });
    }

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
      .where('code', '==', code)
      .orderBy('date', 'desc');

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

  async debit(code: number, value: number, products: any[]): Promise<any> {
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
      products: products,
    });

    return { message: 'Débito realizado com sucesso' };
  }

  async getAllLotteryEntries(): Promise<any[]> {
    const walletsSnapshot = await this.firestore.collection('wallets').get();
    const lotteryEntries: any[] = [];

    for (const walletDoc of walletsSnapshot.docs) {
      const walletData = walletDoc.data();

      const userRef = this.firestore.collection('users').doc(walletData.userId);
      const userSnapshot = await userRef.get();

      if (!userSnapshot.exists) {
        throw new Error('Usuário não encontrado');
      }

      const userData = userSnapshot.data();

      const transactionsRef = this.firestore
        .collection('transactions')
        .where('code', '==', walletData.code)
        .where('type', '==', 'credit');
      const transactionsSnapshot = await transactionsRef.get();

      const totalCredit = transactionsSnapshot.docs.reduce((sum, doc) => {
        const transaction = doc.data();
        return sum + transaction.value;
      }, 0);

      const numberOfEntries = Math.floor(totalCredit / 50);

      const wallet = {
        code: walletData.code,
        balance: walletData.balance,
        user: userData,
        transactions: transactionsSnapshot.docs.map((doc) => doc.data()),
      };

      for (let i = 0; i < numberOfEntries; i++) {
        lotteryEntries.push({ userId: walletData.userId, wallet });
      }
    }

    return lotteryEntries;
  }

  async getTotalCreditedAmount(): Promise<{
    totalCredited: number;
    productSummary: {
      product: string;
      totalQuantity: number;
      totalValue: number;
    }[];
  }> {
    const transactionsRef = this.firestore
      .collection('transactions')
      .where('type', 'in', ['credit', 'debit']);

    const transactionsSnapshot = await transactionsRef.get();

    let totalCredited = 0;

    const productMap = new Map<
      string,
      { totalQuantity: number; totalValue: number }
    >();

    transactionsSnapshot.forEach((doc) => {
      const transaction = doc.data();

      if (transaction.type === 'credit') {
        totalCredited += transaction.value;
      } else if (
        transaction.type === 'debit' &&
        transaction.products &&
        Array.isArray(transaction.products)
      ) {
        transaction.products.forEach((product: any) => {
          const existingProduct = productMap.get(product.name);
          if (existingProduct) {
            existingProduct.totalQuantity += product.quantity;
            existingProduct.totalValue += product.price * product.quantity;
          } else {
            productMap.set(product.name, {
              totalQuantity: product.quantity,
              totalValue: product.price * product.quantity,
            });
          }
        });
      }
    });

    const productSummary = Array.from(
      productMap,
      ([product, { totalQuantity, totalValue }]) => ({
        product,
        totalQuantity,
        totalValue,
      }),
    );

    return {
      totalCredited,
      productSummary,
    };
  }
}
