import { ExchangeService, ExchangeCredentials } from './ExchangeInterface';
import { BinanceService } from './BinanceService';
import { CoinbaseService } from './CoinbaseService';
import { KrakenService } from './KrakenService';

export class ExchangeFactory {
    static createExchange(exchangeName: string, credentials: ExchangeCredentials, useTestnet: boolean = false): ExchangeService {
        switch (exchangeName.toLowerCase()) {
            case 'binance':
                return new BinanceService(credentials, false);
            case 'binance_testnet':
                return new BinanceService(credentials, true);
            case 'coinbase':
                return new CoinbaseService(credentials);
            case 'kraken':
                return new KrakenService(credentials);
            // Add more exchanges here as they are implemented
            default:
                throw new Error(`Unsupported exchange: ${exchangeName}`);
        }
    }

    static getSupportedExchanges(): string[] {
        return ['binance', 'binance_testnet', 'coinbase', 'kraken']; // Add more as implemented
    }
} 