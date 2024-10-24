export interface TokenSecurityData {
  ownerBalance: string;
  creatorBalance: string;
  ownerPercentage: number;
  creatorPercentage: number;
  top10HolderBalance: string;
  top10HolderPercent: number;
}

export interface TokenTradeData {
  address: string;
  holder: number;
  market: number;
  last_trade_unix_time: number;
  last_trade_human_time: string;
  price: number;
  history_30m_price: number;
  price_change_30m_percent: number;
  history_1h_price: number;
  price_change_1h_percent: number;
  history_2h_price: number;
  price_change_2h_percent: number;
  history_4h_price: number;
  price_change_4h_percent: number;
  history_6h_price: number;
  price_change_6h_percent: number;
  history_8h_price: number;
  price_change_8h_percent: number;
  history_12h_price: number;
  price_change_12h_percent: number;
  history_24h_price: number;
  price_change_24h_percent: number;
  unique_wallet_30m: number;
  unique_wallet_history_30m: number;
  unique_wallet_30m_change_percent: number;
  unique_wallet_1h: number;
  unique_wallet_history_1h: number;
  unique_wallet_1h_change_percent: number;
  unique_wallet_2h: number;
  unique_wallet_history_2h: number;
  unique_wallet_2h_change_percent: number;
  unique_wallet_4h: number;
  unique_wallet_history_4h: number;
  unique_wallet_4h_change_percent: number;
  unique_wallet_8h: number;
  unique_wallet_history_8h: number | null;
  unique_wallet_8h_change_percent: number | null;
  unique_wallet_24h: number;
  unique_wallet_history_24h: number | null;
  unique_wallet_24h_change_percent: number | null;
  trade_30m: number;
  trade_history_30m: number;
  trade_30m_change_percent: number;
  sell_30m: number;
  sell_history_30m: number;
  sell_30m_change_percent: number;
  buy_30m: number;
  buy_history_30m: number;
  buy_30m_change_percent: number;
  volume_30m: number;
  volume_30m_usd: number;
  volume_history_30m: number;
  volume_history_30m_usd: number;
  volume_30m_change_percent: number;
  volume_buy_30m: number;
  volume_buy_30m_usd: number;
  volume_buy_history_30m: number;
  volume_buy_history_30m_usd: number;
  volume_buy_30m_change_percent: number;
  volume_sell_30m: number;
  volume_sell_30m_usd: number;
  volume_sell_history_30m: number;
  volume_sell_history_30m_usd: number;
  volume_sell_30m_change_percent: number;
  trade_1h: number;
  trade_history_1h: number;
  trade_1h_change_percent: number;
  sell_1h: number;
  sell_history_1h: number;
  sell_1h_change_percent: number;
  buy_1h: number;
  buy_history_1h: number;
  buy_1h_change_percent: number;
  volume_1h: number;
  volume_1h_usd: number;
  volume_history_1h: number;
  volume_history_1h_usd: number;
  volume_1h_change_percent: number;
  volume_buy_1h: number;
  volume_buy_1h_usd: number;
  volume_buy_history_1h: number;
  volume_buy_history_1h_usd: number;
  volume_buy_1h_change_percent: number;
  volume_sell_1h: number;
  volume_sell_1h_usd: number;
  volume_sell_history_1h: number;
  volume_sell_history_1h_usd: number;
  volume_sell_1h_change_percent: number;
  trade_2h: number;
  trade_history_2h: number;
  trade_2h_change_percent: number;
  sell_2h: number;
  sell_history_2h: number;
  sell_2h_change_percent: number;
  buy_2h: number;
  buy_history_2h: number;
  buy_2h_change_percent: number;
  volume_2h: number;
  volume_2h_usd: number;
  volume_history_2h: number;
  volume_history_2h_usd: number;
  volume_2h_change_percent: number;
  volume_buy_2h: number;
  volume_buy_2h_usd: number;
  volume_buy_history_2h: number;
  volume_buy_history_2h_usd: number;
  volume_buy_2h_change_percent: number;
  volume_sell_2h: number;
  volume_sell_2h_usd: number;
  volume_sell_history_2h: number;
  volume_sell_history_2h_usd: number;
  volume_sell_2h_change_percent: number;
  trade_4h: number;
  trade_history_4h: number;
  trade_4h_change_percent: number;
  sell_4h: number;
  sell_history_4h: number;
  sell_4h_change_percent: number;
  buy_4h: number;
  buy_history_4h: number;
  buy_4h_change_percent: number;
  volume_4h: number;
  volume_4h_usd: number;
  volume_history_4h: number;
  volume_history_4h_usd: number;
  volume_4h_change_percent: number;
  volume_buy_4h: number;
  volume_buy_4h_usd: number;
  volume_buy_history_4h: number;
  volume_buy_history_4h_usd: number;
  volume_buy_4h_change_percent: number;
  volume_sell_4h: number;
  volume_sell_4h_usd: number;
  volume_sell_history_4h: number;
  volume_sell_history_4h_usd: number;
  volume_sell_4h_change_percent: number;
  trade_8h: number;
  trade_history_8h: number | null;
  trade_8h_change_percent: number | null;
  sell_8h: number;
  sell_history_8h: number | null;
  sell_8h_change_percent: number | null;
  buy_8h: number;
  buy_history_8h: number | null;
  buy_8h_change_percent: number | null;
  volume_8h: number;
  volume_8h_usd: number;
  volume_history_8h: number;
  volume_history_8h_usd: number;
  volume_8h_change_percent: number | null;
  volume_buy_8h: number;
  volume_buy_8h_usd: number;
  volume_buy_history_8h: number;
  volume_buy_history_8h_usd: number;
  volume_buy_8h_change_percent: number | null;
  volume_sell_8h: number;
  volume_sell_8h_usd: number;
  volume_sell_history_8h: number;
  volume_sell_history_8h_usd: number;
  volume_sell_8h_change_percent: number | null;
  trade_24h: number;
  trade_history_24h: number;
  trade_24h_change_percent: number | null;
  sell_24h: number;
  sell_history_24h: number;
  sell_24h_change_percent: number | null;
  buy_24h: number;
  buy_history_24h: number;
  buy_24h_change_percent: number | null;
  volume_24h: number;
  volume_24h_usd: number;
  volume_history_24h: number;
  volume_history_24h_usd: number;
  volume_24h_change_percent: number | null;
  volume_buy_24h: number;
  volume_buy_24h_usd: number;
  volume_buy_history_24h: number;
  volume_buy_history_24h_usd: number;
  volume_buy_24h_change_percent: number | null;
  volume_sell_24h: number;
  volume_sell_24h_usd: number;
  volume_sell_history_24h: number;
  volume_sell_history_24h_usd: number;
  volume_sell_24h_change_percent: number | null;
}

export interface HolderData {
  address: string;
  balance: string;
}

export interface ProcessedTokenData {
  security: TokenSecurityData;
  tradeData: TokenTradeData;
  holderDistributionTrend: string; // 'increasing' | 'decreasing' | 'stable'
  highValueHolders: Array<{
    holderAddress: string;
    balanceUsd: string;
  }>;
  recentTrades: boolean;
  highSupplyHoldersCount: number;
  dexScreenerData: DexScreenerData;

  isDexScreenerListed: boolean;
  isDexScreenerPaid: boolean;
}

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
  info: {
    imageUrl: string;
    websites: { label: string; url: string }[];
    socials: { type: string; url: string }[];
  };
  boosts: {
    active: number;
  };
}

export interface DexScreenerData {
  schemaVersion: string;
  pairs: DexScreenerPair[];
}
