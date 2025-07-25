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

export interface FuturesPosition {
    symbol: string;
    positionAmt: number;
    entryPrice: number;
    markPrice: number;
    unrealizedProfit: number;
    leverage: number;
    marginType: string;
    isolatedMargin: number;
    liquidationPrice: number;
    timestamp: number;
}

export interface FundingRate {
    symbol: string;
    fundingRate: number;
    nextFundingTime: number;
}

export interface ExchangeService {
    // Market data
    fetchKlines(symbol: string, interval: string, limit?: number): Promise<Candle[]>;
    
    // Trading
    placeOrder(request: OrderRequest): Promise<OrderResponse>;
    cancelOrder(symbol: string, orderId: string): Promise<boolean>;
    getOrder(symbol: string, orderId: string): Promise<OrderResponse>;
    getOpenOrders?(symbol: string): Promise<any[]>;
    
    // Account
    getBalance(asset?: string): Promise<Balance[]>;
    getAccountInfo(): Promise<any>;
    
    // Futures Trading
    getOpenPositions(): Promise<FuturesPosition[]>;
    getPosition(symbol: string): Promise<FuturesPosition | null>;
    getLeverage(symbol: string): Promise<number>;
    setLeverage(symbol: string, leverage: number): Promise<boolean>;
    getFundingRate(symbol: string): Promise<FundingRate>;
    closePosition(symbol: string): Promise<boolean>;
    
    // Utility
    getExchangeName(): string;
    getSupportedIntervals(): ExchangeInterval;
    validateCredentials(credentials: ExchangeCredentials): Promise<boolean>;
} 