import axios from 'axios';
import * as crypto from 'crypto';
import { ExchangeService, ExchangeCredentials, OrderRequest, OrderResponse, Balance, ExchangeInterval, FuturesPosition } from './ExchangeInterface';
import { Candle } from '../strategyEngine';

export class KrakenService implements ExchangeService {
    private apiKey: string;
    private apiSecret: string;
    private baseUrl: string;
    private futuresBaseUrl: string;
    private useTestnet: boolean;

    constructor(credentials: ExchangeCredentials, useTestnet: boolean = false) {
        this.apiKey = credentials.apiKey;
        this.apiSecret = credentials.apiSecret;
        this.useTestnet = useTestnet;
        if (useTestnet) {
            this.baseUrl = 'https://api-sandbox.kraken.com';
            this.futuresBaseUrl = 'https://demo-futures.kraken.com';
        } else {
            this.baseUrl = 'https://api.kraken.com';
            this.futuresBaseUrl = 'https://futures.kraken.com';
        }
    }

    // Helper method to transform symbols for different API endpoints
    private transformSymbol(symbol: string, forFutures: boolean = false): string {
        if (forFutures) {
            // Remove .P suffix for futures API calls
            return symbol.replace(/\.P$/, '');
        } else {
            // Keep original symbol for spot API calls
            return symbol;
        }
    }

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
            '6h': '360',
            '12h': '720',
            '1d': '1440',
            '1w': '10080',
        };
    }

    async fetchKlines(symbol: string, interval: string, limit: number = 100): Promise<Candle[]> {
        try {
            const krakenInterval = this.mapInterval(interval);
            const isFuturesSymbol = symbol.endsWith('.P');
            
            if (isFuturesSymbol) {
                // Use futures API for futures data
                const transformedSymbol = this.transformSymbol(symbol, true);
                const response = await axios.get(`${this.futuresBaseUrl}/derivatives/api/v3/history`, {
                    params: {
                        symbol: transformedSymbol,
                        resolution: krakenInterval,
                        limit
                    }
                });
                
                const klines: any[] = (response.data as any).history || [];
                return klines.map((kline: any): Candle => ({
                    time: kline.time * 1000, // Convert to milliseconds
                    open: parseFloat(kline.open),
                    high: parseFloat(kline.high),
                    low: parseFloat(kline.low),
                    close: parseFloat(kline.close),
                    volume: parseFloat(kline.volume || '0'),
                }));
            } else {
                // Use spot API for spot data
                const response = await axios.get(`${this.baseUrl}/0/public/OHLC`, {
                    params: {
                        pair: symbol,
                        interval: krakenInterval
                    }
                });

                const data = response.data as any;
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
            }
        } catch (error) {
            console.error('Error fetching Kraken klines:', error);
            throw error;
        }
    }

    async placeOrder(request: OrderRequest): Promise<OrderResponse> {
        const isFuturesSymbol = request.symbol.endsWith('.P');
        
        if (isFuturesSymbol) {
            // Use futures API for futures orders
            const transformedSymbol = this.transformSymbol(request.symbol, true);
            const timestamp = Date.now();
            const nonce = Math.floor(timestamp * 1000);
            
            const params: any = {
                symbol: transformedSymbol,
                side: request.side,
                type: request.type,
                size: request.quantity.toString(),
                nonce: nonce.toString(),
            };

            if (request.price) {
                params['price'] = request.price.toString();
            }

            const signature = this.generateFuturesSignature('/derivatives/api/v3/sendorder', params, nonce);
            
            const response = await axios.post(`${this.futuresBaseUrl}/derivatives/api/v3/sendorder`, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'APIKey': this.apiKey,
                    'Authent': signature,
                },
            });

            const data = response.data as any;
            if (data.error && data.error !== 'none') {
                throw new Error(`Kraken Futures API error: ${data.error}`);
            }

            const order = data.sendStatus;
            return {
                id: order.order_id || '',
                symbol: order.symbol + '.P' || request.symbol, // Add .P suffix back
                side: (order.side?.toLowerCase() as 'buy' | 'sell') || request.side,
                type: (order.type?.toLowerCase() as 'market' | 'limit') || request.type,
                quantity: parseFloat(order.size || '0'),
                price: parseFloat(order.price || '0'),
                status: this.mapOrderStatus(order.status || 'pending'),
                timestamp: Date.now(),
            };
        } else {
            // Use spot API for spot orders
            const timestamp = Date.now() / 1000;
            const nonce = Math.floor(timestamp * 1000);
            
            const params: any = {
                pair: request.symbol,
                type: request.side,
                ordertype: request.type,
                volume: request.quantity.toString(),
                nonce: nonce.toString(),
            };

            if (request.price) {
                params['price'] = request.price.toString();
            }

            const signature = this.generateSignature('/0/private/AddOrder', params, nonce);
            
            const formData = new URLSearchParams();
            Object.entries(params).forEach(([key, value]) => {
                formData.append(key, value as string);
            });

            const response = await axios.post(`${this.baseUrl}/0/private/AddOrder`, formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'API-Key': this.apiKey,
                    'API-Sign': signature,
                },
            });

            const data = response.data as any;
            if (data.error && data.error.length > 0) {
                throw new Error(`Kraken API error: ${data.error.join(', ')}`);
            }

            const orderId = data.result.txid[0];
            return {
                id: orderId,
                symbol: request.symbol,
                side: request.side,
                type: request.type,
                quantity: request.quantity,
                price: request.price || 0,
                status: 'pending',
                timestamp: Date.now(),
            };
        }
    }

    async cancelOrder(symbol: string, orderId: string): Promise<boolean> {
        try {
            const isFuturesSymbol = symbol.endsWith('.P');
            
            if (isFuturesSymbol) {
                // Use futures API for futures orders
                const transformedSymbol = this.transformSymbol(symbol, true);
                const timestamp = Date.now();
                const nonce = Math.floor(timestamp * 1000);
                
                const params = {
                    order_id: orderId,
                    nonce: nonce.toString(),
                };

                const signature = this.generateFuturesSignature('/derivatives/api/v3/cancelorder', params, nonce);
                
                const response = await axios.post(`${this.futuresBaseUrl}/derivatives/api/v3/cancelorder`, params, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'APIKey': this.apiKey,
                        'Authent': signature,
                    },
                });

                const data = response.data as any;
                return data.error === 'none';
            } else {
                // Use spot API for spot orders
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

                const response = await axios.post(`${this.baseUrl}/0/private/CancelOrder`, formData, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'API-Key': this.apiKey,
                        'API-Sign': signature,
                    },
                });

                const data = response.data as any;
                return !data.error || data.error.length === 0;
            }
        } catch (error) {
            console.error('Error cancelling Kraken order:', error);
            return false;
        }
    }

    async getOrder(symbol: string, orderId: string): Promise<OrderResponse> {
        const isFuturesSymbol = symbol.endsWith('.P');
        
        if (isFuturesSymbol) {
            // Use futures API for futures orders
            const transformedSymbol = this.transformSymbol(symbol, true);
            const timestamp = Date.now();
            const nonce = Math.floor(timestamp * 1000);
            
            const params = {
                order_id: orderId,
                nonce: nonce.toString(),
            };

            const signature = this.generateFuturesSignature('/derivatives/api/v3/queryorders', params, nonce);
            
            const response = await axios.post(`${this.futuresBaseUrl}/derivatives/api/v3/queryorders`, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'APIKey': this.apiKey,
                    'Authent': signature,
                },
            });

            const data = response.data as any;
            if (data.error && data.error !== 'none') {
                throw new Error(`Kraken Futures API error: ${data.error}`);
            }

            const order = data.queryStatus[orderId];
            return {
                id: orderId,
                symbol: order.symbol + '.P' || symbol, // Add .P suffix back
                side: (order.side?.toLowerCase() as 'buy' | 'sell') || 'buy',
                type: (order.type?.toLowerCase() as 'market' | 'limit') || 'market',
                quantity: parseFloat(order.size || '0'),
                price: parseFloat(order.price || '0'),
                status: this.mapOrderStatus(order.status || 'pending'),
                timestamp: Date.now(),
            };
        } else {
            // Use spot API for spot orders
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

            const response = await axios.post(`${this.baseUrl}/0/private/QueryOrders`, formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'API-Key': this.apiKey,
                    'API-Sign': signature,
                },
            });

            const data = response.data as any;
            if (data.error && data.error.length > 0) {
                throw new Error(`Kraken API error: ${data.error.join(', ')}`);
            }

            const order = data.result[orderId];
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

            const response = await axios.post(`${this.baseUrl}/0/private/Balance`, formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'API-Key': this.apiKey,
                    'API-Sign': signature,
                },
            });

            const data = response.data as any;
            if (data.error && data.error.length > 0) {
                throw new Error(`Kraken API error: ${data.error.join(', ')}`);
            }

            const balances = Object.entries(data.result)
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

            const response = await axios.post(`${this.baseUrl}/0/private/AccountBalance`, formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'API-Key': this.apiKey,
                    'API-Sign': signature,
                },
            });

            const data = response.data as any;
            if (data.error && data.error.length > 0) {
                throw new Error(`Kraken API error: ${data.error.join(', ')}`);
            }

            return {
                makerCommission: 0.16, // Kraken default maker fee
                takerCommission: 0.26, // Kraken default taker fee
                canTrade: true,
                canWithdraw: true,
                canDeposit: true,
                accounts: data.result,
            };
        } catch (error) {
            console.error('Error getting Kraken account info:', error);
            throw error;
        }
    }

    async getOpenOrders(symbol: string): Promise<any[]> {
        try {
            const isFuturesSymbol = symbol.endsWith('.P');
            
            if (isFuturesSymbol) {
                // Use futures API for futures orders
                const transformedSymbol = this.transformSymbol(symbol, true);
                const timestamp = Date.now();
                const nonce = Math.floor(timestamp * 1000);
                
                const params = {
                    nonce: nonce.toString(),
                };

                const signature = this.generateFuturesSignature('/derivatives/api/v3/openorders', params, nonce);
                
                const response = await axios.post(`${this.futuresBaseUrl}/derivatives/api/v3/openorders`, params, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'APIKey': this.apiKey,
                        'Authent': signature,
                    },
                });

                const data = response.data as any;
                if (data.error && data.error !== 'none') {
                    throw new Error(`Kraken Futures API error: ${data.error}`);
                }

                const orders = data.openOrders || [];
                return orders.filter((order: any) => order.symbol === transformedSymbol);
            } else {
                // Use spot API for spot orders
                const timestamp = Date.now() / 1000;
                const nonce = Math.floor(timestamp * 1000);
                const params: any = { nonce: nonce.toString() };
                const signature = this.generateSignature('/0/private/OpenOrders', params, nonce);
                const formData = new URLSearchParams();
                Object.entries(params).forEach(([key, value]) => {
                    formData.append(key, value as string);
                });
                const response = await axios.post(`${this.baseUrl}/0/private/OpenOrders`, formData, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'API-Key': this.apiKey,
                        'API-Sign': signature,
                    },
                });
                const data = response.data as any;
                if (data.error && data.error.length > 0) {
                    throw new Error(`Kraken API error: ${data.error.join(', ')}`);
                }
                // Filter by symbol if provided
                const orders = Object.values(data.result.open || {});
                if (symbol) {
                    return orders.filter((order: any) => order.descr.pair === symbol);
                }
                return orders;
            }
        } catch (error) {
            console.error('Error fetching Kraken open orders:', String(error as any));
            return [];
        }
    }

    // --- Futures Trading Methods ---
    async getOpenPositions(): Promise<FuturesPosition[]> {
        try {
            const timestamp = Date.now();
            const nonce = Math.floor(timestamp * 1000);
            
            const params = {
                nonce: nonce.toString(),
            };

            const signature = this.generateFuturesSignature('/derivatives/api/v3/openpositions', params, nonce);
            
            const response = await axios.post(`${this.futuresBaseUrl}/derivatives/api/v3/openpositions`, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'APIKey': this.apiKey,
                    'Authent': signature,
                },
            });

            const data = response.data as any;
            if (data.error && data.error !== 'none') {
                throw new Error(`Kraken Futures API error: ${data.error}`);
            }

            const positions = data.openPositions || [];
            return positions
                .filter((pos: any) => parseFloat(pos.size) !== 0)
                .map((pos: any): FuturesPosition => ({
                    symbol: pos.symbol + '.P', // Add .P suffix for consistency
                    positionAmt: parseFloat(pos.size),
                    entryPrice: parseFloat(pos.price),
                    markPrice: parseFloat(pos.markPrice || pos.price),
                    unrealizedProfit: parseFloat(pos.unrealizedPnl || '0'),
                    leverage: parseFloat(pos.leverage || '1'),
                    marginType: pos.marginType || 'cross',
                    isolatedMargin: parseFloat(pos.isolatedMargin || '0'),
                    liquidationPrice: parseFloat(pos.liquidationPrice || '0'),
                    timestamp: Date.now(),
                }));
        } catch (error) {
            console.error('Error getting Kraken futures positions:', error);
            return [];
        }
    }

    async getPosition(symbol: string): Promise<FuturesPosition | null> {
        const positions: FuturesPosition[] = await this.getOpenPositions();
        return positions.find((pos: FuturesPosition) => pos.symbol === symbol) || null;
    }

    async getLeverage(symbol: string): Promise<number> {
        try {
            const transformedSymbol = this.transformSymbol(symbol, true);
            const timestamp = Date.now();
            const nonce = Math.floor(timestamp * 1000);
            
            const params = {
                symbol: transformedSymbol,
                nonce: nonce.toString(),
            };

            const signature = this.generateFuturesSignature('/derivatives/api/v3/leveragepreferences', params, nonce);
            
            const response = await axios.post(`${this.futuresBaseUrl}/derivatives/api/v3/leveragepreferences`, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'APIKey': this.apiKey,
                    'Authent': signature,
                },
            });

            const data = response.data as any;
            if (data.error && data.error !== 'none') {
                return 1; // Default to 1x if error
            }

            return parseFloat(data.leveragePreferences?.leverage || '1');
        } catch (error) {
            console.error('Error getting Kraken leverage:', error);
            return 1;
        }
    }

    async setLeverage(symbol: string, leverage: number): Promise<boolean> {
        try {
            const transformedSymbol = this.transformSymbol(symbol, true);
            const timestamp = Date.now();
            const nonce = Math.floor(timestamp * 1000);
            
            const params = {
                symbol: transformedSymbol,
                leverage: leverage.toString(),
                nonce: nonce.toString(),
            };

            const signature = this.generateFuturesSignature('/derivatives/api/v3/leveragepreferences', params, nonce);
            
            const response = await axios.post(`${this.futuresBaseUrl}/derivatives/api/v3/leveragepreferences`, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'APIKey': this.apiKey,
                    'Authent': signature,
                },
            });

            const data = response.data as any;
            return data.error === 'none';
        } catch (error) {
            console.error('Error setting Kraken leverage:', error);
            return false;
        }
    }

    async getFundingRate(symbol: string): Promise<{ symbol: string; fundingRate: number; nextFundingTime: number }> {
        try {
            const transformedSymbol = this.transformSymbol(symbol, true);
            const response = await axios.get(`${this.futuresBaseUrl}/derivatives/api/v3/tickers`, {
                params: { symbol: transformedSymbol }
            });

            const data = response.data as any;
            if (data.error && data.error !== 'none') {
                return { symbol, fundingRate: 0, nextFundingTime: Date.now() };
            }

            const ticker = data.tickers[transformedSymbol];
            return {
                symbol: ticker.symbol + '.P', // Add .P suffix for consistency
                fundingRate: parseFloat(ticker.fundingRate || '0'),
                nextFundingTime: Date.now() + (8 * 60 * 60 * 1000), // 8 hours from now (approximate)
            };
        } catch (error) {
            console.error('Error getting Kraken funding rate:', error);
            return { symbol, fundingRate: 0, nextFundingTime: Date.now() };
        }
    }

    async closePosition(symbol: string): Promise<boolean> {
        try {
            const position: FuturesPosition | null = await this.getPosition(symbol);
            if (!position || position.positionAmt === 0) return false;
            
            const side: string = position.positionAmt > 0 ? 'sell' : 'buy';
            const quantity: number = Math.abs(position.positionAmt);
            const transformedSymbol = this.transformSymbol(symbol, true);
            
            const timestamp = Date.now();
            const nonce = Math.floor(timestamp * 1000);
            
            const params = {
                symbol: transformedSymbol,
                side: side,
                type: 'market',
                size: quantity.toString(),
                reduceOnly: 'true',
                nonce: nonce.toString(),
            };

            const signature = this.generateFuturesSignature('/derivatives/api/v3/sendorder', params, nonce);
            
            const response = await axios.post(`${this.futuresBaseUrl}/derivatives/api/v3/sendorder`, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'APIKey': this.apiKey,
                    'Authent': signature,
                },
            });

            const data = response.data as any;
            return data.error === 'none';
        } catch (error) {
            console.error('Error closing Kraken position:', error);
            return false;
        }
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

        const sha256 = crypto.createHash('sha256');
        const hmac = crypto.createHmac('sha512', Buffer.from(this.apiSecret, 'base64'));
        
        const noncePostData = `nonce=${nonce}&${postData.toString()}`;
        const sha256Hash = sha256.update(noncePostData, 'utf8').digest('binary');
        const hmacDigest = hmac.update(endpoint + sha256Hash, 'binary').digest('base64');
        
        return hmacDigest;
    }

    private generateFuturesSignature(endpoint: string, params: any, nonce: number): string {
        const postData = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            postData.append(key, value as string);
        });

        const sha256 = crypto.createHash('sha256');
        const hmac = crypto.createHmac('sha256', this.apiSecret);
        
        const noncePostData = `nonce=${nonce}&${postData.toString()}`;
        const sha256Hash = sha256.update(noncePostData, 'utf8').digest('hex');
        const hmacDigest = hmac.update(endpoint + sha256Hash, 'utf8').digest('hex');
        
        return hmacDigest;
    }
} 