import axios from 'axios';
import * as crypto from 'crypto';
import {
    ExchangeService,
    ExchangeCredentials,
    OrderRequest,
    OrderResponse,
    Balance,
    ExchangeInterval,
    FuturesPosition,
    FundingRate
} from './ExchangeInterface';
import { Candle } from '../strategyEngine';

export class CapitalComService implements ExchangeService {
    private credentials: ExchangeCredentials;
    private baseUrl: string;
    private accessToken: string | null = null;
    private tokenExpiry: number = 0;

    constructor(credentials: ExchangeCredentials) {
        this.credentials = credentials;
        this.baseUrl = 'https://api-capital.backend-capital.com';
    }

    getExchangeName(): string {
        return 'capital_com';
    }

    getSupportedIntervals(): ExchangeInterval {
        return {
            '1m': 'MINUTE',
            '5m': 'MINUTE_5',
            '15m': 'MINUTE_15',
            '30m': 'MINUTE_30',
            '1h': 'HOUR',
            '4h': 'HOUR_4',
            '1d': 'DAY',
            '1w': 'WEEK',
        };
    }

    private async authenticate(): Promise<void> {
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return;
        }

        try {
            const response: any = await axios.post(`${this.baseUrl}/api/v1/session`, {
                identifier: this.credentials.apiKey,
                password: this.credentials.apiSecret
            });

            this.accessToken = response.data.accessToken;
            this.tokenExpiry = Date.now() + (response.data.expiresIn * 1000);
        } catch (error) {
            throw new Error('Failed to authenticate with Capital.com');
        }
    }

    private async makeRequest(endpoint: string, method: string = 'GET', data?: any): Promise<any> {
        await this.authenticate();

        const config = {
            method,
            url: `${this.baseUrl}${endpoint}`,
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json',
            },
            data
        };

        try {
            const response = await axios(config);
            return response.data;
        } catch (error: any) {
            if (error.response?.status === 401) {
                // Token expired, try to re-authenticate once
                this.accessToken = null;
                await this.authenticate();
                config.headers.Authorization = `Bearer ${this.accessToken}`;
                const retryResponse = await axios(config);
                return retryResponse.data;
            }
            throw error;
        }
    }

    async fetchKlines(
        symbol: string,
        interval: string,
        limit: number = 100
    ): Promise<Candle[]> {
        try {
            const capitalInterval = this.mapInterval(interval);
            const response = await this.makeRequest(`/api/v1/prices/${symbol}/${capitalInterval}?limit=${limit}`);
            
            return response.prices.map((candle: any): Candle => ({
                time: new Date(candle.snapshotTime).getTime(),
                open: parseFloat(candle.openPrice.bid),
                high: parseFloat(candle.highPrice.bid),
                low: parseFloat(candle.lowPrice.bid),
                close: parseFloat(candle.closePrice.bid),
                volume: parseFloat(candle.lastTradedVolume || '0'),
            }));
        } catch (error) {
            throw new Error(`Failed to fetch klines for ${symbol}: ${error}`);
        }
    }

    async placeOrder(request: OrderRequest): Promise<OrderResponse> {
        try {
            const orderData = {
                epic: request.symbol,
                direction: request.side.toUpperCase(),
                size: request.quantity.toString(),
                orderType: request.type.toUpperCase(),
                ...(request.price && { level: request.price.toString() }),
                guaranteedStop: false,
                stopLevel: null,
                profitLevel: null,
                timeInForce: 'GOOD_TILL_CANCELLED'
            };

            const response = await this.makeRequest('/api/v1/positions', 'POST', orderData);
            
            return {
                id: response.dealReference,
                symbol: request.symbol,
                side: request.side,
                type: request.type,
                quantity: request.quantity,
                price: request.price || 0,
                status: 'pending',
                timestamp: Date.now(),
            };
        } catch (error) {
            throw new Error(`Failed to place order: ${error}`);
        }
    }

    async cancelOrder(symbol: string, orderId: string): Promise<boolean> {
        try {
            await this.makeRequest(`/api/v1/positions/${orderId}`, 'DELETE');
            return true;
        } catch (error) {
            throw new Error(`Failed to cancel order: ${error}`);
        }
    }

    async getOrder(symbol: string, orderId: string): Promise<OrderResponse> {
        try {
            const response = await this.makeRequest(`/api/v1/positions/${orderId}`);
            
            return {
                id: orderId,
                symbol: response.position.epic,
                side: response.position.direction.toLowerCase() as 'buy' | 'sell',
                type: 'market', // Capital.com doesn't distinguish order types in the same way
                quantity: parseFloat(response.position.size),
                price: parseFloat(response.position.level || '0'),
                status: this.mapOrderStatus(response.position.status),
                timestamp: new Date(response.position.createdDate).getTime(),
            };
        } catch (error) {
            throw new Error(`Failed to get order: ${error}`);
        }
    }

    async getBalance(asset?: string): Promise<Balance[]> {
        try {
            const response = await this.makeRequest('/api/v1/accounts');
            
            return response.accounts.map((account: any) => ({
                asset: account.currency,
                free: parseFloat(account.available),
                locked: parseFloat(account.deposit) - parseFloat(account.available),
                total: parseFloat(account.deposit),
            })).filter((balance: Balance) => !asset || balance.asset === asset);
        } catch (error) {
            throw new Error(`Failed to get balance: ${error}`);
        }
    }

    async getAccountInfo(): Promise<any> {
        try {
            return await this.makeRequest('/api/v1/accounts');
        } catch (error) {
            throw new Error(`Failed to get account info: ${error}`);
        }
    }

    async validateCredentials(credentials: ExchangeCredentials): Promise<boolean> {
        try {
            await this.authenticate();
            return true;
        } catch (error) {
            return false;
        }
    }

    // Futures/CFD Trading Methods
    async getOpenPositions(): Promise<FuturesPosition[]> {
        try {
            const response = await this.makeRequest('/api/v1/positions');
            
            return response.positions.map((position: any): FuturesPosition => ({
                symbol: position.epic,
                positionAmt: parseFloat(position.size),
                entryPrice: parseFloat(position.level),
                markPrice: parseFloat(position.marketLevel),
                unrealizedProfit: parseFloat(position.profitLoss),
                leverage: parseFloat(position.leverage || '1'),
                marginType: position.marginType || 'isolated',
                isolatedMargin: parseFloat(position.margin || '0'),
                liquidationPrice: parseFloat(position.stopLevel || '0'),
                timestamp: new Date(position.createdDate).getTime(),
            }));
        } catch (error) {
            throw new Error(`Failed to get open positions: ${error}`);
        }
    }

    async getPosition(symbol: string): Promise<FuturesPosition | null> {
        try {
            const positions = await this.getOpenPositions();
            return positions.find(pos => pos.symbol === symbol) || null;
        } catch (error) {
            throw new Error(`Failed to get position for ${symbol}: ${error}`);
        }
    }

    async getLeverage(symbol: string): Promise<number> {
        try {
            const response = await this.makeRequest(`/api/v1/markets/${symbol}`);
            return parseFloat(response.instrument.leverage || '1');
        } catch (error) {
            throw new Error(`Failed to get leverage for ${symbol}: ${error}`);
        }
    }

    async setLeverage(symbol: string, leverage: number): Promise<boolean> {
        try {
            await this.makeRequest(`/api/v1/positions/${symbol}/leverage`, 'PUT', {
                leverage: leverage.toString()
            });
            return true;
        } catch (error) {
            throw new Error(`Failed to set leverage for ${symbol}: ${error}`);
        }
    }

    async getFundingRate(symbol: string): Promise<FundingRate> {
        try {
            const response = await this.makeRequest(`/api/v1/markets/${symbol}`);
            return {
                symbol,
                fundingRate: parseFloat(response.instrument.fundingRate || '0'),
                nextFundingTime: new Date(response.instrument.nextFundingTime || Date.now()).getTime(),
            };
        } catch (error) {
            throw new Error(`Failed to get funding rate for ${symbol}: ${error}`);
        }
    }

    async closePosition(symbol: string): Promise<boolean> {
        try {
            const position = await this.getPosition(symbol);
            if (!position) {
                return true; // Position already closed
            }

            const closeData = {
                epic: symbol,
                direction: position.positionAmt > 0 ? 'SELL' : 'BUY',
                size: Math.abs(position.positionAmt).toString(),
                orderType: 'MARKET',
                timeInForce: 'IMMEDIATE_OR_CANCEL'
            };

            await this.makeRequest('/api/v1/positions/close', 'POST', closeData);
            return true;
        } catch (error) {
            throw new Error(`Failed to close position for ${symbol}: ${error}`);
        }
    }

    async getOpenOrders(symbol: string): Promise<any[]> {
        try {
            const response = await this.makeRequest('/api/v1/workingorders');
            return response.workingOrders.filter((order: any) => order.epic === symbol);
        } catch (error) {
            throw new Error(`Failed to get open orders: ${error}`);
        }
    }

    private mapInterval(interval: string): string {
        const intervalMap: { [key: string]: string } = {
            '1m': 'MINUTE',
            '5m': 'MINUTE_5',
            '15m': 'MINUTE_15',
            '30m': 'MINUTE_30',
            '1h': 'HOUR',
            '4h': 'HOUR_4',
            '1d': 'DAY',
            '1w': 'WEEK',
        };
        return intervalMap[interval] || 'MINUTE';
    }

    private mapOrderStatus(capitalStatus: string): 'pending' | 'filled' | 'cancelled' | 'rejected' {
        const statusMap: { [key: string]: 'pending' | 'filled' | 'cancelled' | 'rejected' } = {
            'OPEN': 'pending',
            'CONFIRMED': 'filled',
            'CANCELLED': 'cancelled',
            'REJECTED': 'rejected',
        };
        return statusMap[capitalStatus] || 'pending';
    }
} 