import { ExchangeService, ExchangeCredentials, OrderRequest, OrderResponse, Balance, ExchangeInterval } from './ExchangeInterface';
import { Candle } from '../strategyEngine';

export class KrakenService implements ExchangeService {
    private apiKey: string;
    private apiSecret: string;
    private baseUrl: string;

    constructor(credentials: ExchangeCredentials) {
        this.apiKey = credentials.apiKey;
        this.apiSecret = credentials.apiSecret;
        this.baseUrl = 'https://api.kraken.com';
    }

    async fetchKlines(symbol: string, interval: string, limit: number = 100): Promise<Candle[]> {
        try {
            const krakenInterval = this.mapInterval(interval);
            const response = await fetch(
                `${this.baseUrl}/0/public/OHLC?pair=${symbol}&interval=${krakenInterval}`,
                {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch klines: ${response.statusText}`);
            }

            const data = await response.json() as any;
            
            if (data.error && data.error.length > 0) {
                throw new Error(`Kraken API error: ${data.error.join(', ')}`);
            }

            // Kraken returns data in format: [time, open, high, low, close, vwap, volume, count]
            const ohlcData = data.result[symbol] || data.result[Object.keys(data.result)[0]];
            return ohlcData.slice(-limit).map((candle: number[]) => ({
                time: candle[0] * 1000, // Convert to milliseconds
                open: parseFloat(candle[1].toString()),
                high: parseFloat(candle[2].toString()),
                low: parseFloat(candle[3].toString()),
                close: parseFloat(candle[4].toString()),
                volume: parseFloat(candle[6].toString()),
            }));
        } catch (error) {
            console.error('Error fetching Kraken klines:', error);
            throw error;
        }
    }

    async placeOrder(request: OrderRequest): Promise<OrderResponse> {
        try {
            const timestamp = Date.now() / 1000;
            const nonce = Math.floor(timestamp * 1000);
            
            const params = {
                pair: request.symbol,
                type: request.side,
                ordertype: 'market',
                volume: request.quantity.toString(),
                nonce: nonce.toString(),
            };

            const signature = this.generateSignature('/0/private/AddOrder', params, nonce);
            
            const formData = new URLSearchParams();
            Object.entries(params).forEach(([key, value]) => {
                formData.append(key, value);
            });

            const response = await fetch(`${this.baseUrl}/0/private/AddOrder`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'API-Key': this.apiKey,
                    'API-Sign': signature,
                },
                body: formData.toString(),
            });

            if (!response.ok) {
                throw new Error(`Failed to place order: ${response.statusText}`);
            }

            const result = await response.json() as any;
            
            if (result.error && result.error.length > 0) {
                throw new Error(`Kraken API error: ${result.error.join(', ')}`);
            }

            const orderId = result.result.txid[0];

            return {
                id: orderId,
                symbol: request.symbol,
                side: request.side,
                type: 'market',
                quantity: request.quantity,
                price: 0, // Market orders don't have a fixed price
                status: 'pending',
                timestamp: Date.now(),
            };
        } catch (error) {
            console.error('Error placing Kraken order:', error);
            throw error;
        }
    }

    async cancelOrder(symbol: string, orderId: string): Promise<boolean> {
        try {
            const timestamp = Date.now() / 1000;
            const nonce = Math.floor(timestamp * 1000);
            
            const params = {
                txid: orderId,
                nonce: nonce.toString(),
            };

            const signature = this.generateSignature('/0/private/CancelOrder', params, nonce);
            
            const formData = new URLSearchParams();
            Object.entries(params).forEach(([key, value]) => {
                formData.append(key, value);
            });

            const response = await fetch(`${this.baseUrl}/0/private/CancelOrder`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'API-Key': this.apiKey,
                    'API-Sign': signature,
                },
                body: formData.toString(),
            });

            if (!response.ok) {
                return false;
            }

            const result = await response.json() as any;
            return !result.error || result.error.length === 0;
        } catch (error) {
            console.error('Error cancelling Kraken order:', error);
            return false;
        }
    }

    async getOrder(symbol: string, orderId: string): Promise<OrderResponse> {
        try {
            const timestamp = Date.now() / 1000;
            const nonce = Math.floor(timestamp * 1000);
            
            const params = {
                txid: orderId,
                nonce: nonce.toString(),
            };

            const signature = this.generateSignature('/0/private/QueryOrders', params, nonce);
            
            const formData = new URLSearchParams();
            Object.entries(params).forEach(([key, value]) => {
                formData.append(key, value);
            });

            const response = await fetch(`${this.baseUrl}/0/private/QueryOrders`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'API-Key': this.apiKey,
                    'API-Sign': signature,
                },
                body: formData.toString(),
            });

            if (!response.ok) {
                throw new Error(`Failed to get order: ${response.statusText}`);
            }

            const result = await response.json() as any;
            
            if (result.error && result.error.length > 0) {
                throw new Error(`Kraken API error: ${result.error.join(', ')}`);
            }

            const order = result.result[orderId];

            return {
                id: orderId,
                symbol: order.pair,
                side: order.type as 'buy' | 'sell',
                type: order.ordertype as 'market' | 'limit',
                quantity: parseFloat(order.vol),
                price: parseFloat(order.price || '0'),
                status: this.mapOrderStatus(order.status),
                timestamp: Date.now(),
            };
        } catch (error) {
            console.error('Error getting Kraken order:', error);
            throw error;
        }
    }

    async getBalance(asset?: string): Promise<Balance[]> {
        try {
            const timestamp = Date.now() / 1000;
            const nonce = Math.floor(timestamp * 1000);
            
            const params = {
                nonce: nonce.toString(),
            };

            const signature = this.generateSignature('/0/private/Balance', params, nonce);
            
            const formData = new URLSearchParams();
            Object.entries(params).forEach(([key, value]) => {
                formData.append(key, value);
            });

            const response = await fetch(`${this.baseUrl}/0/private/Balance`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'API-Key': this.apiKey,
                    'API-Sign': signature,
                },
                body: formData.toString(),
            });

            if (!response.ok) {
                throw new Error(`Failed to get balances: ${response.statusText}`);
            }

            const result = await response.json() as any;
            
            if (result.error && result.error.length > 0) {
                throw new Error(`Kraken API error: ${result.error.join(', ')}`);
            }

            const balances = Object.entries(result.result)
                .filter(([_, balance]) => parseFloat(balance as string) > 0)
                .map(([asset, balance]) => ({
                    asset: asset as string,
                    free: parseFloat(balance as string),
                    locked: 0, // Kraken doesn't separate free/locked in balance endpoint
                    total: parseFloat(balance as string),
                }));

            if (asset) {
                return balances.filter((b: Balance) => b.asset === asset);
            }
            return balances;
        } catch (error) {
            console.error('Error getting Kraken balances:', error);
            throw error;
        }
    }

    async getAccountInfo(): Promise<any> {
        try {
            const timestamp = Date.now() / 1000;
            const nonce = Math.floor(timestamp * 1000);
            
            const params = {
                nonce: nonce.toString(),
            };

            const signature = this.generateSignature('/0/private/AccountBalance', params, nonce);
            
            const formData = new URLSearchParams();
            Object.entries(params).forEach(([key, value]) => {
                formData.append(key, value);
            });

            const response = await fetch(`${this.baseUrl}/0/private/AccountBalance`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'API-Key': this.apiKey,
                    'API-Sign': signature,
                },
                body: formData.toString(),
            });

            if (!response.ok) {
                throw new Error(`Failed to get account info: ${response.statusText}`);
            }

            const result = await response.json() as any;
            
            if (result.error && result.error.length > 0) {
                throw new Error(`Kraken API error: ${result.error.join(', ')}`);
            }

            return {
                makerCommission: 0.16, // Kraken default maker fee
                takerCommission: 0.26, // Kraken default taker fee
                canTrade: true,
                canWithdraw: true,
                canDeposit: true,
                accounts: result.result,
            };
        } catch (error) {
            console.error('Error getting Kraken account info:', error);
            throw error;
        }
    }

    // --- Get open spot orders for a symbol ---
    async getOpenOrders(symbol: string): Promise<any[]> {
        try {
            const timestamp = Date.now() / 1000;
            const nonce = Math.floor(timestamp * 1000);
            const params: any = { nonce: nonce.toString() };
            const signature = this.generateSignature('/0/private/OpenOrders', params, nonce);
            const formData = new URLSearchParams();
            Object.entries(params).forEach(([key, value]) => {
                formData.append(key, value as string);
            });
            const response = await fetch(`${this.baseUrl}/0/private/OpenOrders`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'API-Key': this.apiKey,
                    'API-Sign': signature,
                },
                body: formData.toString(),
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch open orders: ${response.statusText}`);
            }
            const result: any = await response.json();
            if (result.error && result.error.length > 0) {
                throw new Error(`Kraken API error: ${result.error.join(', ')}`);
            }
            // Filter by symbol if provided
            const orders = Object.values(result.result.open || {});
            if (symbol) {
                return orders.filter((order: any) => order.descr.pair === symbol);
            }
            return orders;
        } catch (error) {
            console.error('Error fetching Kraken open orders:', String(error as any));
            return [];
        }
    }

    // --- Futures stubs to satisfy interface ---
    async getOpenPositions(): Promise<any[]> { return []; }
    async getPosition(symbol: string): Promise<any> { return null; }
    async getLeverage(symbol: string): Promise<number> { return 1; }
    async setLeverage(symbol: string, leverage: number): Promise<boolean> { return true; }
    async getFundingRate(symbol: string): Promise<any> { return { symbol, fundingRate: 0, nextFundingTime: Date.now() }; }
    async closePosition(symbol: string): Promise<boolean> { return true; }

    getExchangeName(): string {
        return 'kraken';
    }

    getSupportedIntervals(): ExchangeInterval {
        return {
            '1m': '1',
            '5m': '5',
            '15m': '15',
            '30m': '30',
            '1h': '60',
            '4h': '240',
            '1d': '1440',
            '1w': '10080',
        };
    }

    async validateCredentials(credentials: ExchangeCredentials): Promise<boolean> {
        try {
            // Test credentials by trying to get account info
            await this.getAccountInfo();
            return true;
        } catch (error) {
            console.error('Kraken credentials validation failed:', error);
            return false;
        }
    }

    private mapInterval(interval: string): string {
        const intervalMap: { [key: string]: string } = {
            '1m': '1',
            '5m': '5',
            '15m': '15',
            '30m': '30',
            '1h': '60',
            '4h': '240',
            '6h': '360',
            '12h': '720',
            '1d': '1440',
            '1w': '10080',
        };
        return intervalMap[interval] || '1';
    }

    private mapOrderStatus(krakenStatus: string): 'pending' | 'filled' | 'cancelled' | 'rejected' {
        const statusMap: { [key: string]: 'pending' | 'filled' | 'cancelled' | 'rejected' } = {
            'open': 'pending',
            'closed': 'filled',
            'canceled': 'cancelled',
            'expired': 'cancelled',
            'rejected': 'rejected',
        };
        return statusMap[krakenStatus] || 'pending';
    }

    private generateSignature(endpoint: string, params: any, nonce: number): string {
        const postData = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            postData.append(key, value as string);
        });

        const crypto = require('crypto');
        const sha256 = crypto.createHash('sha256');
        const hmac = crypto.createHmac('sha512', Buffer.from(this.apiSecret, 'base64'));
        
        const noncePostData = `nonce=${nonce}&${postData.toString()}`;
        const sha256Hash = sha256.update(noncePostData, 'utf8').digest('binary');
        const hmacDigest = hmac.update(endpoint + sha256Hash, 'binary').digest('base64');
        
        return hmacDigest;
    }
} 