import { Inject, Injectable } from '@nestjs/common';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { TransferDto } from './dto/transfer.dto';
import { CancelTransactionDto } from './dto/cancel-transaction.dto';
import { DebitDto } from './dto/debit.dto';
import { FieldValue, Firestore } from '@google-cloud/firestore';
import { v4 as uuidv4 } from 'uuid';
import { CacheService } from '../common/services/cache.service';
import { ProductService } from './product.service';
import { ProductSale } from './entities/product-sale.entity';

@Injectable()
export class WalletService {
  constructor(
    @Inject(Firestore) private readonly firestore: Firestore,
    private readonly cacheService: CacheService,
    private readonly productService: ProductService
  ) { }

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

    // OTIMIZAÇÃO: Invalidar cache relacionado
    this.cacheService.invalidateWalletCache(createWalletDto.code);

    return { message: 'Carteira criada com sucesso' };
  }

  async findOne(code: number): Promise<any> {
    // OTIMIZAÇÃO: Verificar cache primeiro
    const cacheKey = `wallet:${code}:full`;
    const cachedResult = this.cacheService.get(cacheKey);
    
    if (cachedResult) {
      return Object.assign({}, cachedResult, { fromCache: true });
    }

    // OTIMIZAÇÃO: Usar transação para buscar dados relacionados em paralelo
    const result = await this.firestore.runTransaction(async (transaction) => {
      // Buscar carteira
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

      // OTIMIZAÇÃO: Buscar usuário e transações em paralelo
      const userRef = this.firestore.collection('users').doc(walletData.userId);
      const transactionsRef = this.firestore
        .collection('transactions')
        .where('code', '==', code)
        .orderBy('date', 'desc'); // OTIMIZAÇÃO: Ordenar por data

      // Executar consultas em paralelo dentro da transação
      const [userSnapshot, transactionsSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(transactionsRef)
      ]);

      if (!userSnapshot.exists) {
        throw new Error('Usuário não encontrado');
      }

      const userData = userSnapshot.data();
      const transactions = transactionsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));

      return {
        balance: walletData.balance,
        user: userData,
        transactions,
        transactionCount: transactions.length,
        fromCache: false
      };
    });

    // OTIMIZAÇÃO: Cachear resultado por 30 segundos
    this.cacheService.set(cacheKey, result, 30 * 1000);

    return result;
  }

  async remove(code: number): Promise<any> {
    // OTIMIZAÇÃO: Verificar existência antes da transação custosa
    const walletRef = this.firestore
      .collection('wallets')
      .where('code', '==', code)
      .limit(1);
    const quickCheck = await walletRef.get();

    if (quickCheck.empty) {
      throw new Error('Carteira não encontrada');
    }

    // Usar transação atômica para remover carteira, usuário e transações
    await this.firestore.runTransaction(async (transaction) => {
      // Re-buscar dados dentro da transação
      const walletSnapshot = await transaction.get(walletRef);

      if (walletSnapshot.empty) {
        throw new Error('Carteira não encontrada');
      }

      const walletDoc = walletSnapshot.docs[0];
      const walletData = walletDoc.data();

      // OTIMIZAÇÃO: Buscar dados relacionados em paralelo
      const userRef = this.firestore.collection('users').doc(walletData.userId);
      const transactionsRef = this.firestore
        .collection('transactions')
        .where('code', '==', code);

      const [userSnapshot, transactionsSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(transactionsRef)
      ]);

      // OTIMIZAÇÃO: Operações de delete em batch para melhor performance
      const batch = this.firestore.batch();
      
      // Remover carteira
      batch.delete(walletDoc.ref);
      
      // Remover usuário se existir
      if (userSnapshot.exists) {
        batch.delete(userRef);
      }

      // Remover todas as transações relacionadas
      transactionsSnapshot.docs.forEach((transactionDoc) => {
        batch.delete(transactionDoc.ref);
      });

      // OTIMIZAÇÃO: Usar batch.commit() em vez de transaction para deletes múltiplos
      await batch.commit();
    });

    // OTIMIZAÇÃO: Invalidar cache relacionado
    this.cacheService.invalidateWalletCache(code);

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
        status: 'active',
      });
    });

    // OTIMIZAÇÃO: Invalidar cache relacionado
    this.cacheService.invalidateWalletCache(code);

    return { message: 'Crédito adicionado com sucesso' };
  }

  async debit(code: number, debitDto: DebitDto): Promise<any> {
    let totalValue = 0;
    let productSales: ProductSale[] = [];

    // Se tem produtos, calcular valor e preparar vendas
    if (debitDto.items && debitDto.items.length > 0) {
      for (const item of debitDto.items) {
        const product = await this.productService.findOne(item.productId);
        
        if (!product.isActive) {
          throw new Error(`Produto "${product.name}" não está ativo`);
        }

        const subtotal = product.currentPrice * item.quantity;
        totalValue += subtotal;

        productSales.push({
          productId: item.productId,
          productName: product.name,
          priceAtSale: product.currentPrice,
          quantity: item.quantity,
          subtotal: subtotal,
          soldAt: new Date(),
          transactionId: '', // Será preenchido depois
        });
      }
    } else if (debitDto.value) {
      // Débito do sistema sem produtos
      totalValue = debitDto.value;
    } else {
      throw new Error('Deve informar produtos ou valor para débito');
    }

    let transactionId = '';

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
      if (walletData.balance < totalValue) {
        throw new Error('Saldo insuficiente');
      }

      const newBalance = walletData.balance - totalValue;

      // Criar referência para nova transação
      const transactionRef = this.firestore.collection('transactions').doc();
      transactionId = transactionRef.id;

      // Atualizar transactionId nos produtos vendidos
      productSales.forEach(sale => {
        sale.transactionId = transactionId;
      });

      // Operações atômicas: atualizar saldo e registrar transação
      transaction.update(walletDoc.ref, { 
        balance: newBalance,
        updatedAt: FieldValue.serverTimestamp()
      });
      
      transaction.set(transactionRef, {
        code,
        value: totalValue,
        type: 'debit',
        date: FieldValue.serverTimestamp(),
        walletId: walletDoc.id,
        status: 'active',
        hasProducts: productSales.length > 0,
        itemsCount: productSales.length,
      });

      // Salvar produtos vendidos (se houver)
      if (productSales.length > 0) {
        for (const sale of productSales) {
          const saleRef = this.firestore.collection('product-sales').doc();
          transaction.set(saleRef, {
            transactionId: sale.transactionId,
            productId: sale.productId,
            productName: sale.productName,
            priceAtSale: sale.priceAtSale,
            quantity: sale.quantity,
            subtotal: sale.subtotal,
            soldAt: FieldValue.serverTimestamp(),
          });
        }
      }
    });

    // OTIMIZAÇÃO: Invalidar cache relacionado
    this.cacheService.invalidateWalletCache(code);

    const response: any = { 
      message: 'Débito realizado com sucesso',
      transactionId,
      totalValue,
    };

    // Incluir detalhes dos produtos se houver
    if (productSales.length > 0) {
      response.items = productSales.map(sale => ({
        productId: sale.productId,
        productName: sale.productName,
        priceAtSale: sale.priceAtSale,
        quantity: sale.quantity,
        subtotal: sale.subtotal,
      }));
    }

    return response;
  }

  async transfer(fromCode: number, transferDto: TransferDto): Promise<any> {
    // OTIMIZAÇÃO: Validação rápida antes da transação custosa
    if (fromCode === transferDto.toCode) {
      throw new Error('Não é possível transferir para a mesma carteira');
    }

    // OTIMIZAÇÃO: Verificar existência das carteiras antes da transação
    const [fromWalletCheck, toWalletCheck] = await Promise.all([
      this.firestore.collection('wallets').where('code', '==', fromCode).limit(1).get(),
      this.firestore.collection('wallets').where('code', '==', transferDto.toCode).limit(1).get()
    ]);

    if (fromWalletCheck.empty) {
      throw new Error('Carteira de origem não encontrada');
    }
    if (toWalletCheck.empty) {
      throw new Error('Carteira de destino não encontrada');
    }

    // Verificar saldo suficiente antes da transação
    const fromWalletData = fromWalletCheck.docs[0].data();
    if (fromWalletData.balance < transferDto.value) {
      throw new Error('Saldo insuficiente para transferência');
    }

    // Gerar ID único para vincular as duas transações
    const transferId = uuidv4();

    // Usar transação atômica para garantir consistência
    await this.firestore.runTransaction(async (transaction) => {
      // OTIMIZAÇÃO: Re-buscar apenas os dados necessários dentro da transação
      const fromWalletRef = this.firestore
        .collection('wallets')
        .where('code', '==', fromCode)
        .limit(1);
      const toWalletRef = this.firestore
        .collection('wallets')
        .where('code', '==', transferDto.toCode)
        .limit(1);

      const [fromWalletSnapshot, toWalletSnapshot] = await Promise.all([
        transaction.get(fromWalletRef),
        transaction.get(toWalletRef)
      ]);

      const fromWalletDoc = fromWalletSnapshot.docs[0];
      const toWalletDoc = toWalletSnapshot.docs[0];
      const currentFromWalletData = fromWalletDoc.data();
      const currentToWalletData = toWalletDoc.data();

      // Verificação dupla de saldo dentro da transação
      if (currentFromWalletData.balance < transferDto.value) {
        throw new Error('Saldo insuficiente para transferência');
      }

      // OTIMIZAÇÃO: Buscar dados dos usuários em paralelo
      const fromUserRef = this.firestore.collection('users').doc(currentFromWalletData.userId);
      const toUserRef = this.firestore.collection('users').doc(currentToWalletData.userId);
      
      const [fromUserSnapshot, toUserSnapshot] = await Promise.all([
        transaction.get(fromUserRef),
        transaction.get(toUserRef)
      ]);
      
      const fromUserData = fromUserSnapshot.data();
      const toUserData = toUserSnapshot.data();

      // Calcular novos saldos
      const newFromBalance = currentFromWalletData.balance - transferDto.value;
      const newToBalance = currentToWalletData.balance + transferDto.value;

      // Criar referências para as transações
      const transferOutRef = this.firestore.collection('transactions').doc();
      const transferInRef = this.firestore.collection('transactions').doc();

      // OTIMIZAÇÃO: Descrições automáticas otimizadas
      const transferOutDescription = `Transferência para ${toUserData.name}`;
      const transferInDescription = `Transferência de ${fromUserData.name}`;

      // OTIMIZAÇÃO: Operações atômicas otimizadas
      const batch = this.firestore.batch();
      
      // Atualizar saldos
      batch.update(fromWalletDoc.ref, {
        balance: newFromBalance,
        updatedAt: FieldValue.serverTimestamp(),
      });

      batch.update(toWalletDoc.ref, {
        balance: newToBalance,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Registrar transações
      batch.set(transferOutRef, {
        code: fromCode,
        value: transferDto.value,
        type: 'transfer_out',
        date: FieldValue.serverTimestamp(),
        description: transferOutDescription,
        relatedWalletCode: transferDto.toCode,
        transferId: transferId,
        walletId: fromWalletDoc.id,
        status: 'active',
      });

      batch.set(transferInRef, {
        code: transferDto.toCode,
        value: transferDto.value,
        type: 'transfer_in',
        date: FieldValue.serverTimestamp(),
        description: transferInDescription,
        relatedWalletCode: fromCode,
        transferId: transferId,
        walletId: toWalletDoc.id,
        status: 'active',
      });

      // Executar todas as operações em batch
      await batch.commit();
    });

    // OTIMIZAÇÃO: Invalidar cache das duas carteiras envolvidas
    this.cacheService.invalidateWalletCache(fromCode);
    this.cacheService.invalidateWalletCache(transferDto.toCode);

    return {
      message: 'Transferência realizada com sucesso',
      transferId: transferId,
      fromWallet: fromCode,
      toWallet: transferDto.toCode,
      value: transferDto.value,
    };
  }

  async cancelTransaction(code: number, cancelDto: CancelTransactionDto): Promise<any> {
    // PRIMEIRO: Buscar e validar FORA da transação
    const transactionRef = this.firestore.collection('transactions').doc(cancelDto.transactionId);
    const transactionSnapshot = await transactionRef.get();

    if (!transactionSnapshot.exists) {
      throw new Error('Transação não encontrada');
    }

    const transactionData = transactionSnapshot.data();

    // Verificar se a transação pertence à carteira informada
    if (transactionData.code !== code) {
      throw new Error('Transação não pertence a esta carteira');
    }

    // Verificar se a transação já foi cancelada
    if (transactionData.status === 'cancelled') {
      throw new Error('Transação já foi cancelada anteriormente');
    }

    // Buscar a carteira para verificar saldos ANTES da transação
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

    // VALIDAÇÕES ESPECÍFICAS POR TIPO - ANTES DA TRANSAÇÃO
    let transferValidationData = null;

    if (transactionData.type === 'credit') {
      // Para cancelar um crédito, verificar se tem saldo suficiente para debitar
      if (walletData.balance < transactionData.value) {
        throw new Error('Saldo insuficiente para cancelar esta transação de crédito');
      }
    } else if (transactionData.type === 'transfer_out' || transactionData.type === 'transfer_in') {
      // Para transfers, validar saldos das carteiras envolvidas ANTES da transação
      if (!transactionData.transferId) {
        throw new Error('Transfer ID não encontrado na transação');
      }

      // Buscar todas as transações relacionadas
      const relatedTransactionsRef = this.firestore
        .collection('transactions')
        .where('transferId', '==', transactionData.transferId);
      const relatedSnapshot = await relatedTransactionsRef.get();

      // Buscar carteiras envolvidas e dados de usuários
      let fromWalletDoc, toWalletDoc, fromWalletData, toWalletData;
      let fromUserData, toUserData;
      
      for (const doc of relatedSnapshot.docs) {
        const data = doc.data();
        
        if (data.type === 'transfer_out') {
          const fromWalletRef = this.firestore
            .collection('wallets')
            .where('code', '==', data.code)
            .limit(1);
          const fromSnapshot = await fromWalletRef.get();
          fromWalletDoc = fromSnapshot.docs[0];
          fromWalletData = fromWalletDoc.data();
          
          // Buscar dados do usuário origem
          const fromUserRef = this.firestore.collection('users').doc(fromWalletData.userId);
          const fromUserSnapshot = await fromUserRef.get();
          fromUserData = fromUserSnapshot.data();
          
        } else if (data.type === 'transfer_in') {
          const toWalletRef = this.firestore
            .collection('wallets')
            .where('code', '==', data.code)
            .limit(1);
          const toSnapshot = await toWalletRef.get();
          toWalletDoc = toSnapshot.docs[0];
          toWalletData = toWalletDoc.data();
          
          // Buscar dados do usuário destino
          const toUserRef = this.firestore.collection('users').doc(toWalletData.userId);
          const toUserSnapshot = await toUserRef.get();
          toUserData = toUserSnapshot.data();
        }
      }

      // Verificar se a carteira destino tem saldo suficiente para reverter
      if (toWalletData && toWalletData.balance < transactionData.value) {
        throw new Error('A carteira destino não tem saldo suficiente para cancelar esta transferência');
      }

      // Preparar dados para uso na transação atômica
      transferValidationData = {
        relatedSnapshot,
        fromWalletDoc,
        toWalletDoc,
        fromWalletData,
        toWalletData,
        fromUserData,
        toUserData
      };
    }

    // AGORA: Usar transação atômica para garantir consistência (SÓ DEPOIS DAS VALIDAÇÕES)
    await this.firestore.runTransaction(async (transaction) => {
      // Re-buscar dados atualizados dentro da transação
      const currentTransactionSnapshot = await transaction.get(transactionRef);
      const currentWalletSnapshot = await transaction.get(walletDoc.ref);
      
      const currentTransactionData = currentTransactionSnapshot.data();
      const currentWalletData = currentWalletSnapshot.data();

      // Dupla verificação dentro da transação (pode ter mudado entre as chamadas)
      if (currentTransactionData.status === 'cancelled') {
        throw new Error('Transação já foi cancelada anteriormente');
      }

      // Lógica específica por tipo de transação
      if (currentTransactionData.type === 'credit') {
        // Para cancelar um crédito - validação já foi feita, agora só executar
        // Marcar transação como cancelada
        transaction.update(transactionRef, {
          status: 'cancelled',
          cancelledAt: FieldValue.serverTimestamp(),
          cancellationReason: 'Transação de crédito cancelada pelo usuário',
        });

        // Criar transação de reversão (débito)
        const reversalRef = this.firestore.collection('transactions').doc();
        const newBalance = currentWalletData.balance - currentTransactionData.value;

        transaction.update(walletDoc.ref, {
          balance: newBalance,
          updatedAt: FieldValue.serverTimestamp(),
        });

        transaction.set(reversalRef, {
          code,
          value: currentTransactionData.value,
          type: 'debit',
          date: FieldValue.serverTimestamp(),
          description: `Estorno de crédito R$ ${currentTransactionData.value.toFixed(2)} - Cancelamento de transação`,
          walletId: walletDoc.id,
          status: 'active',
          originalTransactionId: cancelDto.transactionId,
        });

      } else if (currentTransactionData.type === 'debit') {
        // Para cancelar um débito, fazer crédito de volta
        transaction.update(transactionRef, {
          status: 'cancelled',
          cancelledAt: FieldValue.serverTimestamp(),
          cancellationReason: 'Transação de débito cancelada pelo usuário',
        });

        // Criar transação de reversão (crédito)
        const reversalRef = this.firestore.collection('transactions').doc();
        const newBalance = currentWalletData.balance + currentTransactionData.value;

        transaction.update(walletDoc.ref, {
          balance: newBalance,
          updatedAt: FieldValue.serverTimestamp(),
        });

        transaction.set(reversalRef, {
          code,
          value: currentTransactionData.value,
          type: 'credit',
          date: FieldValue.serverTimestamp(),
          description: `Estorno de débito R$ ${currentTransactionData.value.toFixed(2)} - Cancelamento de transação`,
          walletId: walletDoc.id,
          status: 'active',
          originalTransactionId: cancelDto.transactionId,
        });

      } else if (currentTransactionData.type === 'transfer_out' || currentTransactionData.type === 'transfer_in') {
        // Para cancelar transfer, usar dados pré-validados
        if (!transferValidationData) {
          throw new Error('Dados de validação de transferência não encontrados');
        }

        const {
          relatedSnapshot,
          fromWalletDoc,
          toWalletDoc,
          fromWalletData,
          toWalletData,
          fromUserData,
          toUserData
        } = transferValidationData;

        // Marcar ambas transações como canceladas
        relatedSnapshot.docs.forEach(doc => {
          transaction.update(doc.ref, {
            status: 'cancelled',
            cancelledAt: FieldValue.serverTimestamp(),
            cancellationReason: 'Transferência cancelada pelo usuário',
          });
        });

        // Reverter saldos
        const newFromBalance = fromWalletData.balance + currentTransactionData.value;
        const newToBalance = toWalletData.balance - currentTransactionData.value;

        transaction.update(fromWalletDoc.ref, {
          balance: newFromBalance,
          updatedAt: FieldValue.serverTimestamp(),
        });

        transaction.update(toWalletDoc.ref, {
          balance: newToBalance,
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Criar transações de reversão
        const reversalTransferId = uuidv4();
        const reversalOutRef = this.firestore.collection('transactions').doc();
        const reversalInRef = this.firestore.collection('transactions').doc();

        // Transação de saída (carteira destino devolvendo)
        transaction.set(reversalOutRef, {
          code: toWalletData.code,
          value: currentTransactionData.value,
          type: 'transfer_out',
          date: FieldValue.serverTimestamp(),
          description: `Estorno de transferência R$ ${currentTransactionData.value.toFixed(2)} para ${fromUserData.name} - Cancelamento`,
          relatedWalletCode: fromWalletData.code,
          transferId: reversalTransferId,
          walletId: toWalletDoc.id,
          status: 'active',
          originalTransactionId: currentTransactionData.transferId,
        });

        // Transação de entrada (carteira origem recebendo de volta)
        transaction.set(reversalInRef, {
          code: fromWalletData.code,
          value: currentTransactionData.value,
          type: 'transfer_in',
          date: FieldValue.serverTimestamp(),
          description: `Estorno de transferência R$ ${currentTransactionData.value.toFixed(2)} de ${toUserData.name} - Cancelamento`,
          relatedWalletCode: toWalletData.code,
          transferId: reversalTransferId,
          walletId: fromWalletDoc.id,
          status: 'active',
          originalTransactionId: currentTransactionData.transferId,
        });

      } else {
        throw new Error('Tipo de transação não suportado para cancelamento');
      }
    });

    // OTIMIZAÇÃO: Invalidar cache relacionado às carteiras envolvidas
    this.cacheService.invalidateWalletCache(code);
    if (transferValidationData) {
      // Para transfers, invalidar cache de ambas as carteiras
      const { fromWalletData, toWalletData } = transferValidationData;
      this.cacheService.invalidateWalletCache(fromWalletData.code);
      this.cacheService.invalidateWalletCache(toWalletData.code);
    }

    return { 
      message: 'Transação cancelada e revertida com sucesso',
      transactionId: cancelDto.transactionId,
      operation: 'Cancelamento processado automaticamente pelo sistema'
    };
  }
}
