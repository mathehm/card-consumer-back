import { Injectable } from '@nestjs/common';
import { Firestore } from '@google-cloud/firestore';

@Injectable()
export class ReportsService {
  constructor(private readonly firestore: Firestore) {}

  async getSalesToday(): Promise<any> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Buscar vendas de hoje
      const salesSnapshot = await this.firestore
        .collection('product-sales')
        .where('soldAt', '>=', today)
        .where('soldAt', '<', tomorrow)
        .get();

      const sales = salesSnapshot.docs.map(doc => doc.data() as any);

      // Agrupar por produto
      const salesByProduct = sales.reduce((acc, sale) => {
        const key = sale.productId;
        if (!acc[key]) {
          acc[key] = {
            productId: sale.productId,
            productName: sale.productName,
            totalQuantity: 0,
            totalValue: 0,
            sales: []
          };
        }
        acc[key].totalQuantity += sale.quantity;
        acc[key].totalValue += sale.subtotal;
        acc[key].sales.push({
          priceAtSale: sale.priceAtSale,
          quantity: sale.quantity,
          subtotal: sale.subtotal,
          soldAt: sale.soldAt
        });
        return acc;
      }, {});

      const totalValue = sales.reduce((sum, sale) => sum + sale.subtotal, 0);
      const totalItems = sales.reduce((sum, sale) => sum + sale.quantity, 0);

      return {
        date: today.toISOString().split('T')[0],
        summary: {
          totalValue,
          totalItems,
          totalTransactions: sales.length
        },
        products: Object.values(salesByProduct)
      };
    } catch (error) {
      throw new Error(`Erro ao buscar vendas de hoje: ${error.message}`);
    }
  }

  async getSalesByProduct(productId: string): Promise<any> {
    try {
      const salesSnapshot = await this.firestore
        .collection('product-sales')
        .where('productId', '==', productId)
        .orderBy('soldAt', 'desc')
        .get();

      if (salesSnapshot.empty) {
        return {
          productId,
          sales: [],
          summary: {
            totalQuantity: 0,
            totalValue: 0,
            salesCount: 0
          }
        };
      }

      const sales = salesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data() as any
      }));

      const totalQuantity = sales.reduce((sum, sale) => sum + sale.quantity, 0);
      const totalValue = sales.reduce((sum, sale) => sum + sale.subtotal, 0);

      return {
        productId,
        productName: sales[0].productName,
        sales,
        summary: {
          totalQuantity,
          totalValue,
          salesCount: sales.length
        }
      };
    } catch (error) {
      throw new Error(`Erro ao buscar vendas do produto: ${error.message}`);
    }
  }

  async getSalesByPeriod(startDate: string, endDate: string): Promise<any> {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      const salesSnapshot = await this.firestore
        .collection('product-sales')
        .where('soldAt', '>=', start)
        .where('soldAt', '<=', end)
        .orderBy('soldAt', 'desc')
        .get();

      const sales = salesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data() as any
      }));

      // Agrupar por data
      const salesByDate = sales.reduce((acc, sale) => {
        const date = sale.soldAt.toDate().toISOString().split('T')[0];
        if (!acc[date]) {
          acc[date] = {
            date,
            totalValue: 0,
            totalQuantity: 0,
            sales: []
          };
        }
        acc[date].totalValue += sale.subtotal;
        acc[date].totalQuantity += sale.quantity;
        acc[date].sales.push(sale);
        return acc;
      }, {});

      const totalValue = sales.reduce((sum, sale) => sum + sale.subtotal, 0);
      const totalQuantity = sales.reduce((sum, sale) => sum + sale.quantity, 0);

      return {
        period: { startDate, endDate },
        summary: {
          totalValue,
          totalQuantity,
          totalSales: sales.length,
          daysWithSales: Object.keys(salesByDate).length
        },
        salesByDate: Object.values(salesByDate)
      };
    } catch (error) {
      throw new Error(`Erro ao buscar vendas por período: ${error.message}`);
    }
  }
}
