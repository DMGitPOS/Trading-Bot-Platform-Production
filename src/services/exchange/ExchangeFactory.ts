import { ExchangeService, ExchangeCredentials } from './ExchangeInterface';
import { BinanceService } from './BinanceService';

export class ExchangeFactory {
  static createExchange(exchangeName: string, credentials: ExchangeCredentials): ExchangeService {
    switch (exchangeName.toLowerCase()) {
      case 'binance':
        return new BinanceService(credentials);
      // Add more exchanges here as they are implemented
      // case 'coinbase':
      //   return new CoinbaseService(credentials);
      // case 'kraken':
      //   return new KrakenService(credentials);
      default:
        throw new Error(`Unsupported exchange: ${exchangeName}`);
    }
  }

  static getSupportedExchanges(): string[] {
    return ['binance']; // Add more as implemented
  }
} 