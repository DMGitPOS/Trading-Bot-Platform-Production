import { Candle } from '../strategyEngine';

export interface ExchangeInterval {
  [key: string]: string;
}

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string; // For some exchanges like Coinbase Pro
}

export interface OrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  quantity: number;
  price?: number;
}

export interface OrderResponse {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  quantity: number;
  price: number;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected';
  timestamp: number;
}

export interface Balance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

export interface ExchangeService {
  // Market data
  fetchKlines(symbol: string, interval: string, limit?: number): Promise<Candle[]>;
  
  // Trading
  placeOrder(request: OrderRequest): Promise<OrderResponse>;
  cancelOrder(symbol: string, orderId: string): Promise<boolean>;
  getOrder(symbol: string, orderId: string): Promise<OrderResponse>;
  
  // Account
  getBalance(asset?: string): Promise<Balance[]>;
  getAccountInfo(): Promise<any>;
  
  // Utility
  getExchangeName(): string;
  getSupportedIntervals(): ExchangeInterval;
  validateCredentials(credentials: ExchangeCredentials): Promise<boolean>;
} 