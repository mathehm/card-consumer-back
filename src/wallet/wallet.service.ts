import { Inject, Injectable } from '@nestjs/common';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { TransferDto } from './dto/transfer.dto';
import { FieldValue, Firestore } from '@google-cloud/firestore';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class WalletService {
  constructor(@Inject(Firestore) private readonly firestore: Firestore) { }

  async create(createWalletDto: CreateWalletDto): Promise<any> {
    // Verificar se o código já existe antes da transação
    const existingWalletRef = this.firestore
      .collection('wallets')
      .where('code', '==', createWalletDto.code)
      .limit(1);
    const existingWalletSnapshot = await existingWalletRef.get();

    if (!existingWalletSnapshot.empty) {
      throw new Error('Código de carteira já existe');
    }

    // Usar transação atômica para criar usuário e carteira
    await this.firestore.runTransaction(async (transaction) => {
      const userRef = this.firestore.collection('users').doc();
      const walletRef = this.firestore.collection('wallets').doc();

      // Converter DTO para objeto simples para o Firestore
      const userData = {
        name: createWalletDto.user.name,
        phone: createWalletDto.user.phone,
      };

      const walletData = {
        code: createWalletDto.code,
        balance: createWalletDto.balance || 0,
        userId: userRef.id,
        createdAt: FieldValue.serverTimestamp(),
      };

      // Operações dentro da transação
      transaction.set(userRef, userData);
      transaction.set(walletRef, walletData);
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
    // Usar transação atômica para remover carteira, usuário e transações
    await this.firestore.runTransaction(async (transaction) => {
      // Buscar a carteira
      const walletRef = this.firestore
        .collection('wallets')
        .where('code', '==', code)
        .limit(1);
      const walletSnapshot = await transaction.get(walletRef);

      if (walletSnapshot.empty) {
        throw new Error('Carteira não encontrada');
      }

      const walletDoc = walletSnapshot.docs[0];
      const walletData = walletDoc.data();

      // Buscar o usuário relacionado
      const userRef = this.firestore.collection('users').doc(walletData.userId);
      const userSnapshot = await transaction.get(userRef);

      // Buscar todas as transações relacionadas
      const transactionsRef = this.firestore
        .collection('transactions')
        .where('code', '==', code);
      const transactionsSnapshot = await transaction.get(transactionsRef);

      // Operações atômicas: remover carteira, usuário e todas as transações
      transaction.delete(walletDoc.ref);
      
      if (userSnapshot.exists) {
        transaction.delete(userRef);
      }

      // Remover todas as transações relacionadas
      transactionsSnapshot.docs.forEach((transactionDoc) => {
        transaction.delete(transactionDoc.ref);
      });
    });

    return { message: 'Carteira cancelada com sucesso' };
  }

  async credit(code: number, value: number): Promise<any> {
    // Usar transação atômica para garantir consistência
    await this.firestore.runTransaction(async (transaction) => {
      // Buscar a carteira dentro da transação
      const walletRef = this.firestore
        .collection('wallets')
        .where('code', '==', code)
        .limit(1);
      const walletSnapshot = await transaction.get(walletRef);

      if (walletSnapshot.empty) {
        throw new Error('Carteira não encontrada');
      }

      const walletDoc = walletSnapshot.docs[0];
      const walletData = walletDoc.data();
      const newBalance = walletData.balance + value;

      // Criar referência para nova transação
      const transactionRef = this.firestore.collection('transactions').doc();

      // Operações atômicas: atualizar saldo e registrar transação
      transaction.update(walletDoc.ref, { 
        balance: newBalance,
        updatedAt: FieldValue.serverTimestamp()
      });
      
      transaction.set(transactionRef, {
        code,
        value: value,
        type: 'credit',
        date: FieldValue.serverTimestamp(),
        walletId: walletDoc.id,
      });
    });

    return { message: 'Crédito adicionado com sucesso' };
  }

  async debit(code: number, value: number): Promise<any> {
    // Usar transação atômica para garantir consistência
    await this.firestore.runTransaction(async (transaction) => {
      // Buscar a carteira dentro da transação
      const walletRef = this.firestore
        .collection('wallets')
        .where('code', '==', code)
        .limit(1);
      const walletSnapshot = await transaction.get(walletRef);

      if (walletSnapshot.empty) {
        throw new Error('Carteira não encontrada');
      }

      const walletDoc = walletSnapshot.docs[0];
      const walletData = walletDoc.data();

      // Verificar saldo suficiente
      if (walletData.balance < value) {
        throw new Error('Saldo insuficiente');
      }

      const newBalance = walletData.balance - value;

      // Criar referência para nova transação
      const transactionRef = this.firestore.collection('transactions').doc();

      // Operações atômicas: atualizar saldo e registrar transação
      transaction.update(walletDoc.ref, { 
        balance: newBalance,
        updatedAt: FieldValue.serverTimestamp()
      });
      
      transaction.set(transactionRef, {
        code,
        value: value,
        type: 'debit',
        date: FieldValue.serverTimestamp(),
        walletId: walletDoc.id,
      });
    });

    return { message: 'Débito realizado com sucesso' };
  }
}
