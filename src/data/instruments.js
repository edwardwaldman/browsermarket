// The tradable universe. Every asset class the terminal lists lives here.

export const SECTORS = {
  TECHNOLOGY: { label: 'TECHNOLOGY', color: '#4c8dff' },
  ENERGY: { label: 'ENERGY', color: '#f5a524' },
  FINANCIALS: { label: 'FINANCIALS', color: '#22d3ee' },
  CONSUMER: { label: 'CONSUMER', color: '#f472b6' },
  HEALTHCARE: { label: 'HEALTHCARE', color: '#34d399' },
  INDUSTRIALS: { label: 'INDUSTRIALS', color: '#a78bfa' },
  MATERIALS: { label: 'MATERIALS', color: '#facc15' },
  REAL_ESTATE: { label: 'REAL ESTATE', color: '#fb923c' },
  DIGITAL: { label: 'DIGITAL ASSETS', color: '#c084fc' },
  MACRO: { label: 'MACRO', color: '#94a3b8' },
};

const stock = (sym, name, sector, price, o = {}) => ({
  sym,
  name,
  kind: 'STOCK',
  sector,
  price,
  vol: o.vol ?? 0.028,
  beta: o.beta ?? 1,
  drift: o.drift ?? 0.00012,
  divYield: o.divYield ?? 0,
  liquidity: o.liquidity ?? 1,
  shares: o.shares ?? 600e6,
  eps: o.eps ?? price / 18,
  tier: o.tier ?? 0,
  color: o.color ?? SECTORS[sector].color,
  blurb: o.blurb ?? '',
});

// --- Equities -------------------------------------------------------------
export const STOCKS = [
  stock('OBBY', 'Obby Dynamics', 'TECHNOLOGY', 58.9, { vol: 0.034, beta: 1.25, liquidity: 1.4, eps: 3.85, divYield: 0.0004, blurb: 'Obstacle-course engines and physics middleware.' }),
  stock('PWN', 'Pwnsoft', 'TECHNOLOGY', 248.4, { vol: 0.036, beta: 1.35, liquidity: 1.2, eps: 9.4, blurb: 'Competitive gaming platform and anti-cheat stack.' }),
  stock('BYTE', 'Bytewise', 'TECHNOLOGY', 147.2, { vol: 0.03, beta: 1.15, liquidity: 1.25, eps: 6.2, divYield: 0.0003, blurb: 'Developer tooling and compiler infrastructure.' }),
  stock('CHIP', 'Blockchip', 'TECHNOLOGY', 196.5, { vol: 0.041, beta: 1.5, liquidity: 1.1, eps: 5.1, blurb: 'Fabless silicon for voxel accelerators.' }),
  stock('PIXL', 'Pixelworks', 'TECHNOLOGY', 84.3, { vol: 0.037, beta: 1.3, liquidity: 0.95, eps: 2.9, blurb: 'Real-time rendering and upscaling pipelines.' }),
  stock('CLDS', 'Cloudspire', 'TECHNOLOGY', 312.7, { vol: 0.029, beta: 1.18, liquidity: 1.05, eps: 11.4, divYield: 0.0002, blurb: 'Region-scale hosting for persistent worlds.' }),

  stock('BLX', 'Bloxxon Energy', 'ENERGY', 151.6, { vol: 0.031, beta: 0.95, liquidity: 1.15, eps: 13.95, divYield: 0.001, blurb: 'Integrated fuel, refining and retail network.' }),
  stock('POWR', 'Powergrid Co', 'ENERGY', 94.1, { vol: 0.019, beta: 0.6, liquidity: 0.9, eps: 5.6, divYield: 0.0014, blurb: 'Regulated transmission and baseload generation.' }),
  stock('SOLR', 'Solaris Array', 'ENERGY', 41.8, { vol: 0.045, beta: 1.45, liquidity: 0.8, eps: 0.9, blurb: 'Utility-scale solar build-out and storage.' }),
  stock('MINE', 'Deepmine Holdings', 'MATERIALS', 67.4, { vol: 0.038, beta: 1.2, liquidity: 0.75, eps: 4.1, divYield: 0.0009, blurb: 'Rare-earth extraction and ore processing.' }),
  stock('FORJ', 'Forgeworks', 'MATERIALS', 128.9, { vol: 0.033, beta: 1.1, liquidity: 0.7, eps: 7.8, divYield: 0.0007, blurb: 'Alloys, castings and heavy fabrication.' }),

  stock('BRIK', 'Brikbank', 'FINANCIALS', 88.7, { vol: 0.024, beta: 1.05, liquidity: 1.1, eps: 9.9, divYield: 0.0012, blurb: 'Retail deposits and small-business lending.' }),
  stock('INSR', 'Obsidian Insurance', 'FINANCIALS', 104.2, { vol: 0.021, beta: 0.75, liquidity: 0.95, eps: 7.08, divYield: 0.001, blurb: 'Property, casualty and catastrophe reinsurance.' }),
  stock('LOOT', 'Lootbank Corp', 'FINANCIALS', 121.5, { vol: 0.035, beta: 1.4, liquidity: 1, eps: 8.4, divYield: 0.0005, blurb: 'Prime brokerage and market making.' }),
  stock('LAND', 'Landmark Realty', 'REAL_ESTATE', 74.2, { vol: 0.022, beta: 0.8, liquidity: 0.7, eps: 3.2, divYield: 0.0018, blurb: 'Commercial property trust with long leases.' }),

  stock('MEDI', 'Mediblox Labs', 'HEALTHCARE', 186.3, { vol: 0.032, beta: 0.85, liquidity: 0.9, eps: 8.1, divYield: 0.0006, blurb: 'Biologics pipeline and diagnostics.' }),
  stock('HELX', 'Helix Genomics', 'HEALTHCARE', 59.7, { vol: 0.052, beta: 1.1, liquidity: 0.65, eps: -0.4, blurb: 'Gene therapy platform, pre-revenue assets.' }),
  stock('SLRP', 'Slurp Beverages', 'CONSUMER', 66.9, { vol: 0.018, beta: 0.55, liquidity: 1, eps: 2.95, divYield: 0.0011, blurb: 'Soft drinks, syrups and vending.' }),
  stock('DOMO', 'Domeno Group', 'CONSUMER', 392.4, { vol: 0.027, beta: 0.9, liquidity: 0.85, eps: 18.6, divYield: 0.0008, blurb: 'Quick-service restaurant franchising.' }),
  stock('FARM', 'Farmline', 'CONSUMER', 38.6, { vol: 0.02, beta: 0.5, liquidity: 0.6, eps: 2.2, divYield: 0.0015, blurb: 'Agricultural inputs and distribution.' }),

  stock('ROBO', 'Robotix Industrial', 'INDUSTRIALS', 188.1, { vol: 0.03, beta: 1.2, liquidity: 0.95, eps: 7.7, divYield: 0.0005, blurb: 'Warehouse automation and articulated arms.' }),
  stock('JETX', 'Jetstream Air', 'INDUSTRIALS', 52.3, { vol: 0.04, beta: 1.35, liquidity: 0.8, eps: 2.6, blurb: 'Low-cost carrier with hedged fuel book.' }),
  stock('RAIL', 'Railworks United', 'INDUSTRIALS', 143.8, { vol: 0.021, beta: 0.85, liquidity: 0.7, eps: 8.9, divYield: 0.0011, blurb: 'Freight rail and intermodal terminals.' }),
  stock('GEAR', 'Gearforge Motors', 'INDUSTRIALS', 96.4, { vol: 0.034, beta: 1.25, liquidity: 0.85, eps: 5.4, divYield: 0.0006, blurb: 'Electric drivetrains and fleet vehicles.' }),

  // Executive tier: gated behind account level, higher beta and fatter tails.
  stock('OMNI', 'Omnicore Systems', 'TECHNOLOGY', 742.6, { vol: 0.045, beta: 1.6, liquidity: 0.9, eps: 21.4, tier: 12, blurb: 'Frontier compute and orbital datacenters.' }),
  stock('VLT', 'Vaulted Capital', 'FINANCIALS', 1284.3, { vol: 0.038, beta: 1.45, liquidity: 0.7, eps: 64.2, tier: 16, divYield: 0.0004, blurb: 'Private credit and structured products.' }),
  stock('HALO', 'Halo Defense', 'INDUSTRIALS', 488.9, { vol: 0.033, beta: 1.05, liquidity: 0.75, eps: 22.8, tier: 20, divYield: 0.0007, blurb: 'Autonomous systems and orbital logistics.' }),
];

// --- Digital assets (24/7, high volatility) -------------------------------
export const CRYPTO = [
  { sym: 'BTX', name: 'Bitrox', kind: 'CRYPTO', sector: 'DIGITAL', price: 41850, vol: 0.06, beta: 1.6, drift: 0.0003, liquidity: 1.3, color: '#f59e0b', blurb: 'The reserve digital asset of the simulation.' },
  { sym: 'ETX', name: 'Ethrix', kind: 'CRYPTO', sector: 'DIGITAL', price: 2480, vol: 0.072, beta: 1.8, drift: 0.00035, liquidity: 1.1, color: '#a78bfa', blurb: 'Smart-contract settlement layer.' },
  { sym: 'SOLX', name: 'Solarix', kind: 'CRYPTO', sector: 'DIGITAL', price: 118.4, vol: 0.095, beta: 2.1, drift: 0.0004, liquidity: 0.85, color: '#22d3ee', blurb: 'High-throughput chain, thin order books.' },
  { sym: 'DOGX', name: 'Dogex', kind: 'CRYPTO', sector: 'DIGITAL', price: 0.184, vol: 0.13, beta: 2.6, drift: 0.0002, liquidity: 0.6, color: '#facc15', blurb: 'Pure sentiment. Moves on headlines alone.' },
];

// --- FX -------------------------------------------------------------------
export const FX = [
  { sym: 'EURX', name: 'Euro Index', kind: 'FX', sector: 'MACRO', price: 1.0842, vol: 0.006, beta: -0.25, drift: 0, liquidity: 2, color: '#60a5fa', blurb: 'Risk-parity anchor. Inverse to the tape.' },
  { sym: 'GBPX', name: 'Sterling Index', kind: 'FX', sector: 'MACRO', price: 1.2674, vol: 0.007, beta: -0.15, drift: 0, liquidity: 1.8, color: '#818cf8', blurb: 'Rate-sensitive cross.' },
  { sym: 'JPYX', name: 'Yen Index', kind: 'FX', sector: 'MACRO', price: 149.32, vol: 0.0055, beta: -0.45, drift: 0, liquidity: 1.9, color: '#f87171', blurb: 'Classic haven. Bids when the tape breaks.' },
  { sym: 'GLDX', name: 'Gold Index', kind: 'FX', sector: 'MACRO', price: 2038.5, vol: 0.011, beta: -0.35, drift: 0.00008, liquidity: 1.5, color: '#fbbf24', blurb: 'Hard money hedge against regime shocks.' },
];

// --- Index products -------------------------------------------------------
export const INDICES = [
  { sym: 'BSX500', name: 'Browser 500 Index', kind: 'INDEX', sector: 'MACRO', basket: 'ALL', color: '#e2e8f0', blurb: 'Cap-weighted index of the whole listed market.' },
  { sym: 'BSXT', name: 'Tech 30 Index', kind: 'INDEX', sector: 'TECHNOLOGY', basket: 'TECHNOLOGY', color: '#4c8dff', blurb: 'The technology complex, cap weighted.' },
  { sym: 'FEAR', name: 'Volatility Index', kind: 'INDEX', sector: 'MACRO', basket: 'VOL', color: '#f43f5e', blurb: 'Implied volatility. Spikes when the market breaks.' },
];

// ETFs are priced off their basket, plus a small tracking error and a fee drag.
export const ETFS = [
  { sym: 'MKTX', name: 'Broad Market Fund', kind: 'ETF', sector: 'MACRO', basket: 'ALL', mult: 1, fee: 0.00002, divYield: 0.0006, color: '#e2e8f0', liquidity: 1.6, blurb: 'One ticket for the entire tape.' },
  { sym: 'TCHX', name: 'Technology Fund', kind: 'ETF', sector: 'TECHNOLOGY', basket: 'TECHNOLOGY', mult: 1, fee: 0.00003, divYield: 0.0002, color: '#4c8dff', liquidity: 1.3, blurb: 'Concentrated technology exposure.' },
  { sym: 'NRGX', name: 'Energy Fund', kind: 'ETF', sector: 'ENERGY', basket: 'ENERGY', mult: 1, fee: 0.00003, divYield: 0.0011, color: '#f5a524', liquidity: 1, blurb: 'Producers, refiners and utilities.' },
  { sym: 'FINX', name: 'Financials Fund', kind: 'ETF', sector: 'FINANCIALS', basket: 'FINANCIALS', mult: 1, fee: 0.00003, divYield: 0.001, color: '#22d3ee', liquidity: 1, blurb: 'Banks, brokers and insurers.' },
  { sym: 'DIVY', name: 'High Dividend Fund', kind: 'ETF', sector: 'MACRO', basket: 'DIV', mult: 0.85, fee: 0.00002, divYield: 0.0022, color: '#34d399', liquidity: 0.9, blurb: 'Lower beta, the fattest daily payout in the list.', tier: 6 },
  { sym: 'BULL3', name: 'Bull 3x Daily', kind: 'ETF', sector: 'MACRO', basket: 'ALL', mult: 3, fee: 0.00012, divYield: 0, color: '#16d97d', liquidity: 1.2, tier: 8, blurb: 'Three times the daily move of the tape. Decays sideways.' },
  { sym: 'BEAR1', name: 'Inverse Market', kind: 'ETF', sector: 'MACRO', basket: 'ALL', mult: -1, fee: 0.00008, divYield: 0, color: '#f43f5e', liquidity: 1.1, tier: 8, blurb: 'Short the tape without a margin account.' },
];

// Futures cash-settle against an underlying index at expiry.
export const FUTURES = [
  { sym: 'BSXF', name: 'Browser 500 Future', kind: 'FUTURE', sector: 'MACRO', underlying: 'BSX500', mult: 5, termDays: 30, initialMargin: 0.08, color: '#e2e8f0', liquidity: 1.4, tier: 10, blurb: 'Front-month index contract, 5x multiplier.' },
  { sym: 'OILF', name: 'Crude Future', kind: 'FUTURE', sector: 'ENERGY', underlying: 'NRGX', mult: 10, termDays: 30, initialMargin: 0.1, color: '#f5a524', liquidity: 1, tier: 10, blurb: 'Energy complex contract, 10x multiplier.' },
  { sym: 'GLDF', name: 'Gold Future', kind: 'FUTURE', sector: 'MACRO', underlying: 'GLDX', mult: 2, termDays: 30, initialMargin: 0.06, color: '#fbbf24', liquidity: 1.1, tier: 12, blurb: 'Metals contract. The hedge of last resort.' },
];

// The launchpad queue. Companies list in order, one window at a time.
export const IPO_PIPELINE = [
  { sym: 'NOVA', name: 'Novabyte AI', sector: 'TECHNOLOGY', offer: 24, vol: 0.055, beta: 1.7, eps: 0.3, hype: 1.6 },
  { sym: 'AQUA', name: 'Aquaflow Systems', sector: 'MATERIALS', offer: 18, vol: 0.038, beta: 0.9, eps: 1.1, hype: 0.9 },
  { sym: 'VOLT', name: 'Voltex Cells', sector: 'ENERGY', offer: 31, vol: 0.05, beta: 1.5, eps: 0.6, hype: 1.35 },
  { sym: 'TOWR', name: 'Towerline Telecom', sector: 'INDUSTRIALS', offer: 42, vol: 0.026, beta: 0.8, eps: 2.4, hype: 0.75 },
  { sym: 'GLOW', name: 'Glowforge Media', sector: 'CONSUMER', offer: 15, vol: 0.06, beta: 1.4, eps: -0.2, hype: 1.5 },
  { sym: 'KELP', name: 'Kelp Nutrition', sector: 'HEALTHCARE', offer: 22, vol: 0.045, beta: 0.95, eps: 0.8, hype: 1.0 },
  { sym: 'ARCX', name: 'Arclight Robotics', sector: 'INDUSTRIALS', offer: 36, vol: 0.048, beta: 1.45, eps: 0.5, hype: 1.4 },
  { sym: 'ZENO', name: 'Zenolith Data', sector: 'TECHNOLOGY', offer: 55, vol: 0.052, beta: 1.55, eps: 1.9, hype: 1.45 },
];

export const ASSET_CLASSES = [
  { id: 'STOCKS', label: 'STOCKS' },
  { id: 'ETFS', label: 'ETFS' },
  { id: 'CRYPTO', label: 'CRYPTO' },
  { id: 'FX', label: 'FX' },
  { id: 'FUT', label: 'FUT' },
  { id: 'IDX', label: 'IDX' },
  { id: 'IPO', label: 'IPO' },
  { id: 'PLAYER', label: 'PLAYER' },
  { id: 'COINS', label: 'COINS' },
  { id: 'COLLECT', label: 'COLLECT' },
  { id: 'MY', label: '★ MY' },
];

export function baseUniverse() {
  return [...STOCKS, ...ETFS, ...CRYPTO, ...FX, ...INDICES, ...FUTURES];
}
