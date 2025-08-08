import { Inject, Injectable } from '@nestjs/common';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { TransferDto } from './dto/transfer.dto';
import { CancelTransactionDto } from './dto/cancel-transaction.dto';
import { DebitDto } from './dto/debit.dto';
import { ListWalletsDto } from './dto/list-wallets.dto';
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
        totalCredit: createWalletDto.balance || 0,
        alreadyWinner: false, // Nova carteira pode participar do sorteio
        createdAt: FieldValue.serverTimestamp(),
      };

      // Operações dentro da transação
      transaction.set(userRef, userData);
      transaction.set(walletRef, walletData);

      // Se foi criada com saldo inicial, registrar transação de crédito
      if (createWalletDto.balance && createWalletDto.balance > 0) {
        const transactionRef = this.firestore.collection('transactions').doc();
        transaction.set(transactionRef, {
          code: createWalletDto.code,
          value: createWalletDto.balance,
          type: 'credit',
          date: FieldValue.serverTimestamp(),
          walletId: walletRef.id,
          status: 'active',
          description: 'Crédito inicial da carteira'
        });
      }
    });

    // OTIMIZAÇÃO: Invalidar cache relacionado
    this.cacheService.invalidateWalletCache(createWalletDto.code);

    return { message: 'Carteira criada com sucesso' };
  }

  async findAll(listWalletsDto: ListWalletsDto): Promise<any> {
    try {
      const { page, limit, search, sortBy, status } = listWalletsDto;
      const offset = (page - 1) * limit;

      // OTIMIZAÇÃO: Verificar cache primeiro
      const cacheKey = `wallets:list:${JSON.stringify(listWalletsDto)}`;
      const cachedResult = this.cacheService.get(cacheKey);
      
      if (cachedResult) {
        return Object.assign({}, cachedResult, { fromCache: true });
      }

      // Buscar todas as carteiras (sem filtros do Firestore para compatibilidade)
      let walletsQuery: any = this.firestore.collection('wallets');
      
      // Aplicar ordenação básica no Firestore (se possível)
      if (sortBy === 'createdAt_asc') {
        walletsQuery = walletsQuery.orderBy('createdAt', 'asc');
      } else if (sortBy === 'createdAt_desc') {
        walletsQuery = walletsQuery.orderBy('createdAt', 'desc');
      } else if (sortBy === 'code_asc') {
        walletsQuery = walletsQuery.orderBy('code', 'asc');
      } else if (sortBy === 'code_desc') {
        walletsQuery = walletsQuery.orderBy('code', 'desc');
      }

      const walletsSnapshot = await walletsQuery.get();

      if (walletsSnapshot.empty) {
        return {
          data: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0
          },
          fromCache: false
        };
      }

      // Buscar dados dos usuários em paralelo - OTIMIZAÇÃO: batch reads
      const userIds = walletsSnapshot.docs.map(doc => doc.data().userId as string);
      const uniqueUserIds: string[] = [...new Set<string>(userIds)]; // Remove duplicatas se houver

      // OTIMIZAÇÃO: Buscar todos os usuários de uma vez
      const userPromises = uniqueUserIds.map((userId: string) => 
        this.firestore.collection('users').doc(userId).get()
      );
      const userSnapshots = await Promise.all(userPromises);
      
      // Criar mapa de usuários para acesso rápido O(1)
      const usersMap = new Map();
      userSnapshots.forEach((snapshot, index) => {
        if (snapshot.exists) {
          usersMap.set(uniqueUserIds[index], snapshot.data());
        }
      });

      // OTIMIZAÇÃO: Processar carteiras com acesso direto ao mapa de usuários
      const walletsData = walletsSnapshot.docs.map((walletDoc) => {
        const walletData = walletDoc.data();
        const userData = usersMap.get(walletData.userId);

        // Calcular totalCredit dinamicamente se não existir (sem queries adicionais)
        let totalCredit = walletData.totalCredit;
        if (totalCredit === undefined) {
          totalCredit = 0; // Define como 0 e pode ser recalculado em background se necessário
        }

        // Determinar status do sorteio
        let lotteryStatus = 'ineligible';
        if (walletData.alreadyWinner === true) {
          lotteryStatus = 'winner';
        } else if (totalCredit > 0) {
          lotteryStatus = 'eligible';
        }

        return {
          id: walletDoc.id,
          code: walletData.code,
          balance: walletData.balance,
          totalCredit,
          alreadyWinner: walletData.alreadyWinner || false,
          winnerMarkedAt: walletData.winnerMarkedAt,
          createdAt: walletData.createdAt,
          lotteryStatus,
          user: userData ? {
            name: userData.name,
            phone: userData.phone
          } : null
        };
      });

      // Aplicar filtros em memória
      let filteredData = walletsData;

      // Filtro de busca
      if (search && search.trim()) {
        const searchTerm = search.toLowerCase().trim();
        filteredData = filteredData.filter(wallet => 
          wallet.code.toString().includes(searchTerm) ||
          (wallet.user?.name && wallet.user.name.toLowerCase().includes(searchTerm)) ||
          (wallet.user?.phone && wallet.user.phone.includes(searchTerm))
        );
      }

      // Filtro de status
      if (status !== 'all') {
        filteredData = filteredData.filter(wallet => wallet.lotteryStatus === status);
      }

      // Aplicar ordenação em memória (para campos que não podem ser ordenados no Firestore)
      if (sortBy && !sortBy.includes('createdAt') && !sortBy.includes('code')) {
        const [field, direction] = sortBy.split('_');
        filteredData.sort((a, b) => {
          let aValue = a[field];
          let bValue = b[field];
          
          // Tratamento especial para userName
          if (field === 'userName') {
            aValue = a.user?.name || '';
            bValue = b.user?.name || '';
          }
          
          if (direction === 'asc') {
            return aValue > bValue ? 1 : -1;
          } else {
            return aValue < bValue ? 1 : -1;
          }
        });
      }

      // Aplicar paginação
      const total = filteredData.length;
      const totalPages = Math.ceil(total / limit);
      const paginatedData = filteredData.slice(offset, offset + limit);

      const result = {
        data: paginatedData,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        },
        filters: {
          search: search || '',
          sortBy: sortBy || 'createdAt_desc',
          status: status || 'all'
        },
        fromCache: false
      };

      // OTIMIZAÇÃO: Cachear resultado por 10 minutos (aumentado de 5 para reduzir leituras)
      this.cacheService.set(cacheKey, result, 10 * 60 * 1000);

      return result;

    } catch (error) {
      throw new Error(`Erro ao listar carteiras: ${error.message}`);
    }
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
      
      // Buscar produtos relacionados para transações que têm produtos
      const transactions = await Promise.all(
        transactionsSnapshot.docs.map(async (doc) => {
          const transactionData = doc.data();
          const transactionBase = {
            id: doc.id,
            ...transactionData,
          };

          // OTIMIZAÇÃO: Só buscar produtos se realmente tem produtos E é do tipo debit
          if (transactionData.hasProducts === true && transactionData.type === 'debit') {
            try {
              const productSalesRef = this.firestore
                .collection('product-sales')
                .where('transactionId', '==', doc.id);
              
              const productSalesSnapshot = await transaction.get(productSalesRef);
              
              if (!productSalesSnapshot.empty) {
                const products = productSalesSnapshot.docs.map(productDoc => ({
                  id: productDoc.id,
                  ...productDoc.data(),
                }));
                
                return {
                  ...transactionBase,
                  products
                };
              }
            } catch (error) {
              // Em caso de erro, retornar transação sem produtos para não quebrar
              console.warn(`Erro ao buscar produtos para transação ${doc.id}:`, error);
            }
          }

          return transactionBase;
        })
      );

      return {
        code: walletData.code,
        balance: walletData.balance,
        totalCredit: walletData.totalCredit,
        user: userData,
        transactions,
        transactionCount: transactions.length,
        fromCache: false
      };
    });

    // OTIMIZAÇÃO: Cachear resultado por 2 minutos (aumentado de 30s para reduzir leituras)
    this.cacheService.set(cacheKey, result, 2 * 60 * 1000);

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

      // OTIMIZAÇÃO: Usar operações da transação diretamente
      // Remover carteira
      transaction.delete(walletDoc.ref);
      
      // Remover usuário se existir
      if (userSnapshot.exists) {
        transaction.delete(userRef);
      }

      // Remover todas as transações relacionadas
      transactionsSnapshot.docs.forEach((transactionDoc) => {
        transaction.delete(transactionDoc.ref);
      });
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
      const newTotalCredit = (walletData.totalCredit || 0) + value;

      // Criar referência para nova transação
      const transactionRef = this.firestore.collection('transactions').doc();

      // Operações atômicas: atualizar saldo, totalCredit e registrar transação
      transaction.update(walletDoc.ref, { 
        balance: newBalance,
        totalCredit: newTotalCredit,
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
    this.cacheService.invalidateWalletListCache();
    this.cacheService.invalidateLotteryCache(); // Cache de sorteio também precisa ser atualizado

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

      // Calcular novos saldos (sem atualizar totalCredit em transferências)
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
      
      // Atualizar apenas os saldos (totalCredit não muda em transferências)
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
        const newTotalCredit = Math.max(0, (currentWalletData.totalCredit || 0) - currentTransactionData.value);

        transaction.update(walletDoc.ref, {
          balance: newBalance,
          totalCredit: newTotalCredit, // Ajustar totalCredit ao cancelar crédito
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
        const newTotalCredit = (currentWalletData.totalCredit || 0) + currentTransactionData.value;

        transaction.update(walletDoc.ref, {
          balance: newBalance,
          totalCredit: newTotalCredit, // Ajustar totalCredit ao cancelar débito (volta como crédito)
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

        // Reverter apenas os saldos (totalCredit não muda em transferências)
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

  async getNextLotteryWinner(valorPorEntrada: number): Promise<any | null> {
    try {
      // OTIMIZAÇÃO CRÍTICA: Cache de dados de sorteio por 2 minutos
      const cacheKey = `lottery:eligible-wallets:${valorPorEntrada}`;
      const cachedEligibleWallets = this.cacheService.get<any[]>(cacheKey);

      let eligibleWallets: any[];

      if (cachedEligibleWallets && Array.isArray(cachedEligibleWallets)) {
        eligibleWallets = cachedEligibleWallets;
      } else {
        // OTIMIZAÇÃO: Buscar apenas carteiras elegíveis (com totalCredit > valorPorEntrada e não vencedoras)
        const walletsRef = this.firestore
          .collection('wallets')
          .where('totalCredit', '>=', valorPorEntrada)
          .where('alreadyWinner', '!=', true);
        
        const walletsSnapshot = await walletsRef.get();

        if (walletsSnapshot.empty) {
          return null; // Não há carteiras elegíveis
        }

        // OTIMIZAÇÃO: Buscar usuários em lote (batch reads)
        const userIds = walletsSnapshot.docs.map(doc => doc.data().userId);
        const uniqueUserIds = [...new Set(userIds)];
        
        // Buscar todos os usuários de uma vez usando Promise.all
        const userPromises = uniqueUserIds.map(userId => 
          this.firestore.collection('users').doc(userId).get()
        );
        const userSnapshots = await Promise.all(userPromises);
        
        // Criar mapa de usuários para acesso rápido
        const usersMap = new Map();
        userSnapshots.forEach((snapshot, index) => {
          if (snapshot.exists) {
            usersMap.set(uniqueUserIds[index], snapshot.data());
          }
        });

        // Processar carteiras elegíveis
        eligibleWallets = walletsSnapshot.docs
          .map(walletDoc => {
            const walletData = walletDoc.data();
            const userData = usersMap.get(walletData.userId);
            
            if (!userData || !walletData.totalCredit) {
              return null;
            }

            const entries = Math.floor(walletData.totalCredit / valorPorEntrada);
            
            if (entries <= 0) {
              return null;
            }

            return {
              walletId: walletDoc.id,
              code: walletData.code,
              balance: walletData.balance,
              totalCredit: walletData.totalCredit,
              entries: entries,
              user: {
                name: userData.name,
                phone: userData.phone
              },
              createdAt: walletData.createdAt
            };
          })
          .filter(Boolean);

        // Cache por 2 minutos para reduzir leituras em sorteios consecutivos
        this.cacheService.set(cacheKey, eligibleWallets, 2 * 60 * 1000);
      }

      if (eligibleWallets.length === 0) {
        return null;
      }

      // OTIMIZAÇÃO: Montagem otimizada do array de entradas
      const lotteryEntries: any[] = [];
      for (const wallet of eligibleWallets) {
        for (let i = 0; i < wallet.entries; i++) {
          lotteryEntries.push(wallet);
        }
      }

      // Sortear aleatoriamente uma entrada
      const randomIndex = Math.floor(Math.random() * lotteryEntries.length);
      const winner = lotteryEntries[randomIndex];

      // Retornar o vencedor com informações adicionais do sorteio
      return {
        ...winner,
        lotteryInfo: {
          totalEntries: lotteryEntries.length,
          totalParticipants: eligibleWallets.length,
          valorPorEntrada: valorPorEntrada,
          drawnAt: new Date(),
          winnerChance: (winner.entries / lotteryEntries.length * 100).toFixed(2) + '%'
        }
      };

    } catch (error) {
      throw new Error(`Erro ao realizar sorteio: ${error.message}`);
    }
  }

  async markWalletAsWinner(walletCode: number): Promise<any> {
    try {
      // Buscar a carteira pelo código
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

      // TRATAMENTO: Verificar compatibilidade e status
      // Se não tem alreadyWinner, considera que pode participar (undefined = false)
      if (walletData.alreadyWinner === true) {
        throw new Error('Esta carteira já foi premiada anteriormente');
      }

      // Buscar dados do usuário para incluir na resposta
      const userRef = this.firestore.collection('users').doc(walletData.userId);
      const userSnapshot = await userRef.get();
      
      if (!userSnapshot.exists) {
        throw new Error('Usuário da carteira não encontrado');
      }

      const userData = userSnapshot.data();

      // Usar transação atômica para marcar como vencedora
      await this.firestore.runTransaction(async (transaction) => {
        // Re-verificar dentro da transação
        const currentWalletSnapshot = await transaction.get(walletDoc.ref);
        
        if (!currentWalletSnapshot.exists) {
          throw new Error('Carteira não encontrada na transação');
        }

        const currentWalletData = currentWalletSnapshot.data();
        
        if (currentWalletData.alreadyWinner === true) {
          throw new Error('Carteira já foi premiada durante a transação');
        }

        // Marcar como vencedora
        transaction.update(walletDoc.ref, {
          alreadyWinner: true,
          winnerMarkedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });

        // Opcionalmente, registrar uma transação de histórico do prêmio
        const winnerLogRef = this.firestore.collection('lottery-winners').doc();
        transaction.set(winnerLogRef, {
          walletCode: walletCode,
          walletId: walletDoc.id,
          userName: userData.name,
          userPhone: userData.phone,
          markedAt: FieldValue.serverTimestamp(),
          markedBy: 'system' // Você pode passar um parâmetro para identificar quem marcou
        });
      });

      // OTIMIZAÇÃO: Invalidar cache relacionado
      this.cacheService.invalidateWalletCache(walletCode);
      this.cacheService.invalidateLotteryCache(); // Cache de sorteio precisa ser atualizado

      return {
        message: 'Carteira marcada como vencedora com sucesso',
        walletCode: walletCode,
        user: {
          name: userData.name,
          phone: userData.phone
        },
        markedAt: new Date()
      };

    } catch (error) {
      throw new Error(`Erro ao marcar carteira como vencedora: ${error.message}`);
    }
  }
}
