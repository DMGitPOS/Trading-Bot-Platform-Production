import {
    ExchangeService,
    ExchangeCredentials,
    OrderRequest,
    OrderResponse,
    Balance,
    ExchangeInterval
} from './ExchangeInterface';
import { Candle } from '../strategyEngine';

export class CoinbaseService implements ExchangeService {
    private apiKey: string;
    private apiSecret: string;
    private passphrase: string;
    private baseUrl: string;

    constructor(credentials: ExchangeCredentials) {
        this.apiKey = credentials.apiKey;
        this.apiSecret = credentials.apiSecret;
        this.passphrase = credentials.passphrase || '';
        this.baseUrl = 'https://api.exchange.coinbase.com';
    }

    async fetchKlines(symbol: string, interval: string, limit: number = 100): Promise<Candle[]> {
        try {
            const coinbaseInterval = this.mapInterval(interval);
            const response = await fetch(
                `${this.baseUrl}/products/${symbol}/candles?granularity=${coinbaseInterval}&limit=${limit}`,
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

            const data = await response.json() as number[][];

            // Coinbase returns data in format: [timestamp, open, high, low, close, volume]
            return data.map((candle: number[]) => ({
                time: candle[0] * 1000, // Convert to milliseconds
                open: parseFloat(candle[1].toString()),
                high: parseFloat(candle[2].toString()),
                low: parseFloat(candle[3].toString()),
                close: parseFloat(candle[4].toString()),
                volume: parseFloat(candle[5].toString()),
            }));
        } catch (error) {
            console.error('Error fetching Coinbase klines:', error);
            throw error;
        }
    }

    async placeOrder(request: OrderRequest): Promise<OrderResponse> {
        try {
            const timestamp = Date.now() / 1000;
            const body = {
                client_order_id: `order_${Date.now()}`,
                product_id: request.symbol,
                side: request.side.toUpperCase(),
                order_configuration: {
                    market_market_ioc: {
                        quote_size: request.quantity.toString(),
                    },
                },
            };

            const signature = this.generateSignature('POST', '/orders', JSON.stringify(body), timestamp);

            const response = await fetch(`${this.baseUrl}/orders`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'CB-ACCESS-KEY': this.apiKey,
                    'CB-ACCESS-SIGN': signature,
                    'CB-ACCESS-TIMESTAMP': timestamp.toString(),
                    'CB-ACCESS-PASSPHRASE': this.passphrase,
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                throw new Error(`Failed to place order: ${response.statusText}`);
            }

            const order = await response.json() as any;

            return {
                id: order.order_id,
                symbol: order.product_id,
                side: order.side.toLowerCase() as 'buy' | 'sell',
                type: 'market',
                quantity: parseFloat(order.filled_size || '0'),
                price: parseFloat(order.average_filled_price || '0'),
                status: this.mapOrderStatus(order.status),
                timestamp: Date.now(),
            };
        } catch (error) {
            console.error('Error placing Coinbase order:', error);
            throw error;
        }
    }

    async cancelOrder(symbol: string, orderId: string): Promise<boolean> {
        try {
            const timestamp = Date.now() / 1000;
            const signature = this.generateSignature('DELETE', `/orders/${orderId}`, '', timestamp);

            const response = await fetch(`${this.baseUrl}/orders/${orderId}`, {
                method: 'DELETE',
                headers: {
                    'CB-ACCESS-KEY': this.apiKey,
                    'CB-ACCESS-SIGN': signature,
                    'CB-ACCESS-TIMESTAMP': timestamp.toString(),
                    'CB-ACCESS-PASSPHRASE': this.passphrase,
                },
            });

            return response.ok;
        } catch (error) {
            console.error('Error cancelling Coinbase order:', error);
            return false;
        }
    }

    async getOrder(symbol: string, orderId: string): Promise<OrderResponse> {
        try {
            const timestamp = Date.now() / 1000;
            const signature = this.generateSignature('GET', `/orders/${orderId}`, '', timestamp);

            const response = await fetch(`${this.baseUrl}/orders/${orderId}`, {
                method: 'GET',
                headers: {
                    'CB-ACCESS-KEY': this.apiKey,
                    'CB-ACCESS-SIGN': signature,
                    'CB-ACCESS-TIMESTAMP': timestamp.toString(),
                    'CB-ACCESS-PASSPHRASE': this.passphrase,
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to get order: ${response.statusText}`);
            }

            const order = await response.json() as any;

            return {
                id: order.order_id,
                symbol: order.product_id,
                side: order.side.toLowerCase() as 'buy' | 'sell',
                type: order.order_configuration?.market_market_ioc ? 'market' : 'limit',
                quantity: parseFloat(order.filled_size || '0'),
                price: parseFloat(order.average_filled_price || '0'),
                status: this.mapOrderStatus(order.status),
                timestamp: Date.now(),
            };
        } catch (error) {
            console.error('Error getting Coinbase order:', error);
            throw error;
        }
    }

    async getBalance(asset?: string): Promise<Balance[]> {
        try {
            const timestamp = Date.now() / 1000;
            const signature = this.generateSignature('GET', '/accounts', '', timestamp);

            const response = await fetch(`${this.baseUrl}/accounts`, {
                method: 'GET',
                headers: {
                    'CB-ACCESS-KEY': this.apiKey,
                    'CB-ACCESS-SIGN': signature,
                    'CB-ACCESS-TIMESTAMP': timestamp.toString(),
                    'CB-ACCESS-PASSPHRASE': this.passphrase,
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to get balances: ${response.statusText}`);
            }

            const accounts = await response.json() as any[];

            const balances = accounts
                .filter((account: any) => parseFloat(account.available_balance.value) > 0 || parseFloat(account.hold.value) > 0)
                .map((account: any) => ({
                    asset: account.currency,
                    free: parseFloat(account.available_balance.value),
                    locked: parseFloat(account.hold.value),
                    total: parseFloat(account.available_balance.value) + parseFloat(account.hold.value),
                }));

            if (asset) {
                return balances.filter((b: Balance) => b.asset === asset);
            }
            return balances;
        } catch (error) {
            console.error('Error getting Coinbase balances:', error);
            throw error;
        }
    }

    async getAccountInfo(): Promise<any> {
        try {
            const timestamp = Date.now() / 1000;
            const signature = this.generateSignature('GET', '/accounts', '', timestamp);

            const response = await fetch(`${this.baseUrl}/accounts`, {
                method: 'GET',
                headers: {
                    'CB-ACCESS-KEY': this.apiKey,
                    'CB-ACCESS-SIGN': signature,
                    'CB-ACCESS-TIMESTAMP': timestamp.toString(),
                    'CB-ACCESS-PASSPHRASE': this.passphrase,
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to get account info: ${response.statusText}`);
            }

            const accounts = await response.json();

            return {
                makerCommission: 0.4, // Coinbase Advanced Trade default
                takerCommission: 0.6, // Coinbase Advanced Trade default
                canTrade: true,
                canWithdraw: true,
                canDeposit: true,
                accounts: accounts,
            };
        } catch (error) {
            console.error('Error getting Coinbase account info:', error);
            throw error;
        }
    }

    // --- Get open spot orders for a symbol ---
    async getOpenOrders(symbol: string): Promise<any[]> {
        try {
            const timestamp = Date.now() / 1000;
            const path = `/orders?status=OPEN&product_id=${symbol}`;
            const signature = this.generateSignature('GET', path, '', timestamp);
            const response = await fetch(`${this.baseUrl}/orders?status=OPEN&product_id=${symbol}`, {
                method: 'GET',
                headers: {
                    'CB-ACCESS-KEY': this.apiKey,
                    'CB-ACCESS-SIGN': signature,
                    'CB-ACCESS-TIMESTAMP': timestamp.toString(),
                    'CB-ACCESS-PASSPHRASE': this.passphrase,
                },
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch open orders: ${response.statusText}`);
            }
            const data: any = await response.json();
            return Array.isArray(data) ? data : (data.orders || []);
        } catch (error) {
            console.error('Error fetching Coinbase open orders:', error);
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
        return 'coinbase';
    }

    getSupportedIntervals(): ExchangeInterval {
        return {
            '1m': '60',
            '5m': '300',
            '15m': '900',
            '1h': '3600',
            '6h': '21600',
            '1d': '86400',
        };
    }

    async validateCredentials(credentials: ExchangeCredentials): Promise<boolean> {
        try {
            // Test credentials by trying to get account info
            await this.getAccountInfo();
            return true;
        } catch (error) {
            console.error('Coinbase credentials validation failed:', error);
            return false;
        }
    }

    private mapInterval(interval: string): string {
        const intervalMap: { [key: string]: string } = {
            '1m': '60',
            '5m': '300',
            '15m': '900',
            '30m': '1800',
            '1h': '3600',
            '4h': '14400',
            '6h': '21600',
            '12h': '43200',
            '1d': '86400',
        };
        return intervalMap[interval] || '60';
    }

    private mapOrderStatus(coinbaseStatus: string): 'pending' | 'filled' | 'cancelled' | 'rejected' {
        const statusMap: { [key: string]: 'pending' | 'filled' | 'cancelled' | 'rejected' } = {
            'OPEN': 'pending',
            'FILLED': 'filled',
            'CANCELLED': 'cancelled',
            'REJECTED': 'rejected',
        };
        return statusMap[coinbaseStatus] || 'pending';
    }

    private generateSignature(method: string, path: string, body: string, timestamp: number): string {
        const message = timestamp + method + path + body;
        const crypto = require('crypto');
        return crypto.createHmac('sha256', this.apiSecret).update(message).digest('base64');
    }
} 