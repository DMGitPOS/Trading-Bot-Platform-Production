import { ExchangeService, ExchangeCredentials } from './ExchangeInterface';
import { BinanceService } from './BinanceService';
import { CoinbaseService } from './CoinbaseService';
import { KrakenService } from './KrakenService';

export class ExchangeFactory {
  static createExchange(exchangeName: string, credentials: ExchangeCredentials): ExchangeService {
    switch (exchangeName.toLowerCase()) {
      case 'binance':
        return new BinanceService(credentials);
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
    return ['binance', 'coinbase', 'kraken']; // Add more as implemented
  }
} 