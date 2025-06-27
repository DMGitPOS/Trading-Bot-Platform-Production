import { Spot, Interval } from '@binance/connector-typescript';
import { ExchangeService, ExchangeCredentials, OrderRequest, OrderResponse, Balance, ExchangeInterval } from './ExchangeInterface';
import { Candle } from '../strategyEngine';

export class BinanceService implements ExchangeService {
  private client: Spot;
  private credentials: ExchangeCredentials;

  constructor(credentials: ExchangeCredentials) {
    this.credentials = credentials;
    this.client = new Spot(credentials.apiKey, credentials.apiSecret);
  }

  async fetchKlines(symbol: string, interval: string, limit: number = 100): Promise<Candle[]> {
    const binanceInterval = this.mapInterval(interval);
    const klines = await this.client.uiklines(symbol, binanceInterval, { limit });
    
    return klines.map((kline: any[]) => ({
      time: kline[0],
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5]),
    }));
  }

  async placeOrder(request: OrderRequest): Promise<OrderResponse> {
    const order = await this.client.newOrder(
      request.symbol,
      request.side.toUpperCase() as any,
      request.type.toUpperCase() as any,
      {
        quantity: request.quantity,
        price: request.price,
      }
    );

    return {
      id: order.orderId?.toString() || '',
      symbol: order.symbol || request.symbol,
      side: (order.side?.toLowerCase() as 'buy' | 'sell') || request.side,
      type: (order.type?.toLowerCase() as 'market' | 'limit') || request.type,
      quantity: parseFloat(order.origQty || '0'),
      price: parseFloat(order.price || '0'),
      status: this.mapOrderStatus(order.status || 'NEW'),
      timestamp: Date.now(),
    };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<boolean> {
    try {
      await this.client.cancelOrder(symbol, { orderId: parseInt(orderId) });
      return true;
    } catch (error) {
      console.error('Error cancelling order:', error);
      return false;
    }
  }

  async getOrder(symbol: string, orderId: string): Promise<OrderResponse> {
    const order = await this.client.getOrder(symbol, { orderId: parseInt(orderId) });
    
    return {
      id: order.orderId?.toString() || orderId,
      symbol: order.symbol || symbol,
      side: (order.side?.toLowerCase() as 'buy' | 'sell') || 'buy',
      type: (order.type?.toLowerCase() as 'market' | 'limit') || 'market',
      quantity: parseFloat(order.origQty || '0'),
      price: parseFloat(order.price || '0'),
      status: this.mapOrderStatus(order.status || 'NEW'),
      timestamp: order.time || Date.now(),
    };
  }

  async getBalance(asset?: string): Promise<Balance[]> {
    const account = await this.client.accountInformation();
    const balances = account.balances
      .filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
      .map((b: any) => ({
        asset: b.asset,
        free: parseFloat(b.free),
        locked: parseFloat(b.locked),
        total: parseFloat(b.free) + parseFloat(b.locked),
      }));

    if (asset) {
      return balances.filter(b => b.asset === asset);
    }
    return balances;
  }

  async getAccountInfo(): Promise<any> {
    return await this.client.accountInformation();
  }

  getExchangeName(): string {
    return 'binance';
  }

  getSupportedIntervals(): ExchangeInterval {
    return {
      '1m': Interval['1m'],
      '3m': Interval['3m'],
      '5m': Interval['5m'],
      '15m': Interval['15m'],
      '30m': Interval['30m'],
      '1h': Interval['1h'],
      '2h': Interval['2h'],
      '4h': Interval['4h'],
      '6h': Interval['6h'],
      '8h': Interval['8h'],
      '12h': Interval['12h'],
      '1d': Interval['1d'],
      '3d': Interval['3d'],
      '1w': Interval['1w'],
      '1M': Interval['1M'],
    };
  }

  async validateCredentials(credentials: ExchangeCredentials): Promise<boolean> {
    try {
      const testClient = new Spot(credentials.apiKey, credentials.apiSecret);
      await testClient.accountInformation();
      return true;
    } catch (error) {
      return false;
    }
  }

  private mapInterval(interval: string): Interval {
    const intervalMap: { [key: string]: Interval } = {
      '1m': Interval['1m'],
      '3m': Interval['3m'],
      '5m': Interval['5m'],
      '15m': Interval['15m'],
      '30m': Interval['30m'],
      '1h': Interval['1h'],
      '2h': Interval['2h'],
      '4h': Interval['4h'],
      '6h': Interval['6h'],
      '8h': Interval['8h'],
      '12h': Interval['12h'],
      '1d': Interval['1d'],
      '3w': Interval['3d'],
      '1w': Interval['1w'],
      '1M': Interval['1M'],
    };
    return intervalMap[interval] || Interval['1m'];
  }

  private mapOrderStatus(binanceStatus: string): 'pending' | 'filled' | 'cancelled' | 'rejected' {
    const statusMap: { [key: string]: 'pending' | 'filled' | 'cancelled' | 'rejected' } = {
      'NEW': 'pending',
      'PARTIALLY_FILLED': 'pending',
      'FILLED': 'filled',
      'CANCELED': 'cancelled',
      'REJECTED': 'rejected',
    };
    return statusMap[binanceStatus] || 'pending';
  }
} 