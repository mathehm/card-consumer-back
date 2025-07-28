export class ProductSale {
  id?: string;
  transactionId: string;
  productId: string;
  productName: string;
  priceAtSale: number;
  quantity: number;
  subtotal: number;
  soldAt: Date;
}
