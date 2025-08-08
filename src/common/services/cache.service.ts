import { Injectable } from '@nestjs/common';

interface CacheItem<T> {
  data: T;
  expiration: number;
}

@Injectable()
export class CacheService {
  private cache = new Map<string, CacheItem<any>>();
  private readonly DEFAULT_TTL = 60 * 1000; // 1 minuto

  set<T>(key: string, value: T, ttl: number = this.DEFAULT_TTL): void {
    const expiration = Date.now() + ttl;
    this.cache.set(key, { data: value, expiration });
  }

  get<T>(key: string): T | null {
    const item = this.cache.get(key);
    
    if (!item) {
      return null;
    }

    if (Date.now() > item.expiration) {
      this.cache.delete(key);
      return null;
    }

    return item.data as T;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  // Limpar cache expirado periodicamente
  clearExpired(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiration) {
        this.cache.delete(key);
      }
    }
  }

  // Invalidar cache relacionado a uma carteira
  invalidateWalletCache(code: number): void {
    const patterns = [
      `wallet:${code}`,
      `wallet:${code}:*`,
      `user:wallet:${code}`,
      `transactions:${code}`
    ];

    for (const [key] of this.cache.entries()) {
      for (const pattern of patterns) {
        if (key.includes(pattern.replace('*', ''))) {
          this.cache.delete(key);
        }
      }
    }

    // IMPORTANTE: Invalidar também o cache de listagem
    // pois mudanças em uma carteira afetam a listagem geral
    this.invalidateWalletListCache();
  }

  // Invalidar cache de listagem de carteiras
  invalidateWalletListCache(): void {
    // Buscar todas as chaves que começam com "wallets:list:" 
    // (que é o padrão usado na listagem com parâmetros)
    for (const [key] of this.cache.entries()) {
      if (key.startsWith('wallets:list:')) {
        this.cache.delete(key);
      }
    }
  }
}
