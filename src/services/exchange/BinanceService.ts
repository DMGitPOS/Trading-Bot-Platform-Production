import axios from 'axios';
import * as crypto from 'crypto';
import { Spot, Interval } from '@binance/connector-typescript';
import {
    ExchangeService,
    ExchangeCredentials,
    OrderRequest,
    OrderResponse,
    Balance,
    ExchangeInterval,
    FuturesPosition
} from './ExchangeInterface';
import { Candle } from '../strategyEngine';

export class BinanceService implements ExchangeService {
    private client: Spot;
    private credentials: ExchangeCredentials;
    private futuresBaseUrl = 'https://fapi.binance.com';

    constructor(credentials: ExchangeCredentials) {
        this.credentials = credentials;
        this.client = new Spot(credentials.apiKey, credentials.apiSecret);
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

    async fetchKlines(
        symbol: string,
        interval: string,
        limit: number = 100
    ): Promise<Candle[]> {
        try {
            const binanceInterval = this.mapInterval(interval);
            const klines: any[] = await this.client.uiklines(symbol, binanceInterval, { limit });
            return klines.map((kline: any[]): Candle => ({
                time: kline[0],
                open: parseFloat(kline[1]),
                high: parseFloat(kline[2]),
                low: parseFloat(kline[3]),
                close: parseFloat(kline[4]),
                volume: parseFloat(kline[5]),
            }));
        } catch (error) {
            console.error('Error in fetchKlines:', error);
            throw error;
        }
    }

    async placeOrder(request: OrderRequest): Promise<OrderResponse> {
        const order: any = await this.client.newOrder(
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
        const order: any = await this.client.getOrder(symbol, { orderId: parseInt(orderId) });
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
        const account: any = await this.client.accountInformation();
        const balances: Balance[] = account.balances
            .filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
            .map((b: any): Balance => ({
                asset: b.asset,
                free: parseFloat(b.free),
                locked: parseFloat(b.locked),
                total: parseFloat(b.free) + parseFloat(b.locked),
            }));
        if (asset) {
            return balances.filter((b: Balance) => b.asset === asset);
        }
        return balances;
    }

    async getAccountInfo(): Promise<any> {
        return await this.client.accountInformation();
    }

    async validateCredentials(credentials: ExchangeCredentials): Promise<boolean> {
        try {
            console.log(credentials)
            const testClient = new Spot(credentials.apiKey, credentials.apiSecret);
            console.log(testClient)
            const ss = await testClient.accountInfo();
            console.log(ss);
            await testClient.accountInformation();
            return true;
        } catch (error) {
            return false;
        }
    }

    async getOpenPositions(): Promise<FuturesPosition[]> {
        const data: any[] = await this.sendFuturesRequest('/fapi/v2/positionRisk');
        return data
            .filter((pos: any) => parseFloat(pos.positionAmt) !== 0)
            .map((pos: any): FuturesPosition => ({
                symbol: pos.symbol,
                positionAmt: parseFloat(pos.positionAmt),
                entryPrice: parseFloat(pos.entryPrice),
                markPrice: parseFloat(pos.markPrice),
                unrealizedProfit: parseFloat(pos.unRealizedProfit),
                leverage: parseFloat(pos.leverage),
                marginType: pos.marginType,
                isolatedMargin: parseFloat(pos.isolatedMargin),
                liquidationPrice: parseFloat(pos.liquidationPrice),
                timestamp: Date.now(),
            }));
    }

    async getPosition(symbol: string): Promise<FuturesPosition | null> {
        const positions: FuturesPosition[] = await this.getOpenPositions();
        return positions.find((pos: FuturesPosition) => pos.symbol === symbol) || null;
    }

    async getLeverage(symbol: string): Promise<number> {
        const data: any[] = await this.sendFuturesRequest('/fapi/v2/positionRisk', { symbol });
        if (Array.isArray(data) && data.length > 0) {
            return parseFloat(data[0].leverage);
        }
        return 1;
    }

    async setLeverage(symbol: string, leverage: number): Promise<boolean> {
        const data: any = await this.sendFuturesPostRequest('/fapi/v1/leverage', { symbol, leverage });
        return data && data.leverage === leverage;
    }

    async getFundingRate(symbol: string): Promise<{ symbol: string; fundingRate: number; nextFundingTime: number }> {
        const data: any[] = await this.sendFuturesRequest('/fapi/v1/fundingRate', { symbol, limit: 1 });
        if (Array.isArray(data) && data.length > 0) {
            return {
                symbol: data[0].symbol,
                fundingRate: parseFloat(data[0].fundingRate),
                nextFundingTime: data[0].fundingTime,
            };
        }
        return { symbol, fundingRate: 0, nextFundingTime: Date.now() };
    }

    async closePosition(symbol: string): Promise<boolean> {
        const position: FuturesPosition | null = await this.getPosition(symbol);
        if (!position || position.positionAmt === 0) return false;
        const side: string = position.positionAmt > 0 ? 'SELL' : 'BUY';
        const quantity: number = Math.abs(position.positionAmt);
        const params = {
            symbol,
            side,
            type: 'MARKET',
            quantity,
            reduceOnly: 'true',
        };
        const data: any = await this.sendFuturesPostRequest('/fapi/v1/order', params);
        return !!data && !!data.orderId;
    }

    async getOpenOrders(symbol: string): Promise<any[]> {
        try {
            const response: any[] = await (this.client as any).openOrders({ symbol });
            return response || [];
        } catch (error) {
            console.error('Error fetching open orders:', error);
            return [];
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
            '3d': Interval['3d'],
            '1w': Interval['1w'],
            '1M': Interval['1M'],
        };
        return intervalMap[interval] || Interval['1m'];
    }

    private mapOrderStatus(
        binanceStatus: string
    ): 'pending' | 'filled' | 'cancelled' | 'rejected' {
        const statusMap: { [key: string]: 'pending' | 'filled' | 'cancelled' | 'rejected' } = {
            'NEW': 'pending',
            'PARTIALLY_FILLED': 'pending',
            'FILLED': 'filled',
            'CANCELED': 'cancelled',
            'REJECTED': 'rejected',
        };
        return statusMap[binanceStatus] || 'pending';
    }

    private signFuturesParams(params: Record<string, any>): string {
        const query: string = Object.entries(params)
            .map(([key, val]) => `${key}=${encodeURIComponent(val)}`)
            .join('&');
        const signature: string = crypto
            .createHmac('sha256', this.credentials.apiSecret)
            .update(query)
            .digest('hex');
        return `${query}&signature=${signature}`;
    }

    private async sendFuturesRequest(
        endpoint: string,
        params: Record<string, any> = {}
    ): Promise<any> {
        const timestamp: number = Date.now();
        const query: string = this.signFuturesParams({ ...params, timestamp });
        const url: string = `${this.futuresBaseUrl}${endpoint}?${query}`;
        const headers = { 'X-MBX-APIKEY': this.credentials.apiKey };
        const response = await axios.get(url, { headers });
        return response.data;
    }

    private async sendFuturesPostRequest(
        endpoint: string,
        params: Record<string, any> = {}
    ): Promise<any> {
        const timestamp: number = Date.now();
        const query: string = this.signFuturesParams({ ...params, timestamp });
        const url: string = `${this.futuresBaseUrl}${endpoint}?${query}`;
        const headers = { 'X-MBX-APIKEY': this.credentials.apiKey };
        const response = await axios.post(url, null, { headers });
        return response.data;
    }
} 