import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Firestore, FieldValue } from '@google-cloud/firestore';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from './entities/product.entity';
import { CacheService } from '../common/services/cache.service';

@Injectable()
export class ProductService {
  constructor(
    private readonly firestore: Firestore,
    private readonly cacheService: CacheService,
  ) {}

  async create(createProductDto: CreateProductDto): Promise<{ message: string; productId: string }> {
    try {
      // Verificar se produto com mesmo nome já existe
      const existingProduct = await this.firestore
        .collection('products')
        .where('name', '==', createProductDto.name)
        .where('isActive', '==', true)
        .get();

      if (!existingProduct.empty) {
        throw new ConflictException('Produto com este nome já existe');
      }

      const productRef = this.firestore.collection('products').doc();
      
      const productData = {
        name: createProductDto.name,
        category: createProductDto.category,
        currentPrice: createProductDto.currentPrice,
        isActive: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      await productRef.set(productData);

      // Limpar cache de produtos ativos
      this.cacheService.delete('products:active');

      return {
        message: 'Produto criado com sucesso',
        productId: productRef.id
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new Error(`Erro ao criar produto: ${error.message}`);
    }
  }

  async findAll(): Promise<Product[]> {
    try {
      const cacheKey = 'products:all';
      const cachedResult = this.cacheService.get<Product[]>(cacheKey);

      if (cachedResult) {
        return cachedResult;
      }

      const snapshot = await this.firestore
        .collection('products')
        .orderBy('name', 'asc')
        .get();

      const products = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Product[];

      this.cacheService.set(cacheKey, products, 600); // Cache por 10 minutos
      return products;
    } catch (error) {
      throw new Error(`Erro ao buscar produtos: ${error.message}`);
    }
  }

  async findActive(): Promise<Product[]> {
    try {
      const cacheKey = 'products:active';
      const cachedResult = this.cacheService.get<Product[]>(cacheKey);

      if (cachedResult) {
        return cachedResult;
      }

      const snapshot = await this.firestore
        .collection('products')
        .where('isActive', '==', true)
        .orderBy('name', 'asc')
        .get();

      const products = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Product[];

      this.cacheService.set(cacheKey, products, 600); // Cache por 10 minutos
      return products;
    } catch (error) {
      throw new Error(`Erro ao buscar produtos ativos: ${error.message}`);
    }
  }

  async findOne(id: string): Promise<Product> {
    try {
      const cacheKey = `product:${id}`;
      const cachedResult = this.cacheService.get<Product>(cacheKey);

      if (cachedResult) {
        return cachedResult;
      }

      const productDoc = await this.firestore.collection('products').doc(id).get();

      if (!productDoc.exists) {
        throw new NotFoundException('Produto não encontrado');
      }

      const product = {
        id: productDoc.id,
        ...productDoc.data()
      } as Product;

      this.cacheService.set(cacheKey, product, 600); // Cache por 10 minutos
      return product;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new Error(`Erro ao buscar produto: ${error.message}`);
    }
  }

  async update(id: string, updateProductDto: UpdateProductDto): Promise<{ message: string }> {
    try {
      const productDoc = await this.firestore.collection('products').doc(id).get();

      if (!productDoc.exists) {
        throw new NotFoundException('Produto não encontrado');
      }

      // Se está alterando o nome, verificar duplicação
      if (updateProductDto.name) {
        const existingProduct = await this.firestore
          .collection('products')
          .where('name', '==', updateProductDto.name)
          .where('isActive', '==', true)
          .get();

        const hasConflict = existingProduct.docs.some(doc => doc.id !== id);
        
        if (hasConflict) {
          throw new ConflictException('Produto com este nome já existe');
        }
      }

      const updateData = {
        ...updateProductDto,
        updatedAt: FieldValue.serverTimestamp(),
      };

      await productDoc.ref.update(updateData);

      // Limpar caches relacionados
      this.cacheService.delete(`product:${id}`);
      this.cacheService.delete('products:all');
      this.cacheService.delete('products:active');

      return { message: 'Produto atualizado com sucesso' };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      throw new Error(`Erro ao atualizar produto: ${error.message}`);
    }
  }

  async remove(id: string): Promise<{ message: string }> {
    try {
      const productDoc = await this.firestore.collection('products').doc(id).get();

      if (!productDoc.exists) {
        throw new NotFoundException('Produto não encontrado');
      }

      // Soft delete - apenas marca como inativo
      await productDoc.ref.update({
        isActive: false,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Limpar caches relacionados
      this.cacheService.delete(`product:${id}`);
      this.cacheService.delete('products:all');
      this.cacheService.delete('products:active');

      return { message: 'Produto removido com sucesso' };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new Error(`Erro ao remover produto: ${error.message}`);
    }
  }

  async activate(id: string): Promise<{ message: string }> {
    try {
      const productDoc = await this.firestore.collection('products').doc(id).get();

      if (!productDoc.exists) {
        throw new NotFoundException('Produto não encontrado');
      }

      await productDoc.ref.update({
        isActive: true,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Limpar caches relacionados
      this.cacheService.delete(`product:${id}`);
      this.cacheService.delete('products:all');
      this.cacheService.delete('products:active');

      return { message: 'Produto ativado com sucesso' };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new Error(`Erro ao ativar produto: ${error.message}`);
    }
  }
}
