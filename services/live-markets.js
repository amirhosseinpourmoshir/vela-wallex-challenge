import WebSocket from 'ws';
import { readMarketCatalog } from './market-catalog.js';

export function createLiveMarkets(db, config, broadcast) {
  const prices = new Map();
  let stopped = false, socket, reconnect, restTimer, publishTimer, restBusy = false;
  let socketConnected = false, restError = '', retry = 1000, lastRestAt = null;
  let lastFrameAt=0;
  let catalog=readMarketCatalog(db);
  const approved = () => catalog;
  function snapshot() {
    const catalog = approved();
    const now = Date.now();
    return { ...catalog, live: { socketConnected, restError, lastRestAt, serverTime: new Date().toISOString(), staleAfterMs: 20000 }, markets: catalog.markets.map(m => {
      const tick = prices.get(m.symbol);
      return { ...m, ...(tick || {}), updatedAt: tick?.updatedAt || catalog.sync?.checkedAt, priceSource: tick?.priceSource || 'stored_snapshot', stale: !tick || now - Date.parse(tick.updatedAt) > 20000 };
    }) };
  }
  function publish() {
    if (!publishTimer) publishTimer = setTimeout(() => { publishTimer = null; if (!stopped) broadcast({ type: 'market_state', ...snapshot() }); }, 150);
  }
  function apply(data, source, eligible) {
    const symbol = data.symbol;
    if (!eligible.has(symbol) || !Number.isFinite(Number(data.price)) || Number(data.price) <= 0) return;
    const previous = prices.get(symbol);
    const change = data['24h_ch'] ?? data.change_24h;
    prices.set(symbol, { price: String(data.price), change24h: Number.isFinite(Number(change)) ? Number(change) : previous?.change24h ?? null, updatedAt: new Date().toISOString(), priceSource: source });
  }
  async function refresh() {
    if (restBusy || stopped) return;
    restBusy = true;
    try {
      catalog=readMarketCatalog(db);
      const response = await fetch(config.wallex.baseUrl + '/hector/web/v1/markets', { signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (!response.ok) throw Error();
      const data = await response.json();
      if (!data.success || !Array.isArray(data.result?.markets)) throw Error();
      if (stopped) return;
      const eligible = new Set(approved().markets.map(m => m.symbol));
      for (const m of data.result.markets) apply(m, 'wallex_rest', eligible);
      lastRestAt = new Date().toISOString(); restError = '';
    } catch { restError = 'دریافت پشتیبان قیمت از والکس موقتاً ناموفق بود.'; }
    finally { restBusy = false; publish(); }
  }
  function connect() {
    if (stopped) return;
    socket = new WebSocket(config.wallex.wsUrl, { handshakeTimeout: 10000, maxPayload: 2 * 1024 * 1024 });
    socket.on('open', () => {lastFrameAt=Date.now();socket.send(JSON.stringify({ id: 1, connect: {} }));});
    socket.on('ping',()=>{lastFrameAt=Date.now();});
    socket.on('message', raw => {
      lastFrameAt=Date.now();
      for (const line of raw.toString().split('\n')) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (Object.keys(msg).length === 0) { if (socket.readyState === 1) socket.send('{}'); continue; }
          if (msg.id === 1 && msg.connect) { socket.send(JSON.stringify({ id: 2, subscribe: { channel: 'public:all@price' } })); }
          if (msg.id === 2 && msg.subscribe) { socketConnected = true; retry = 1000; publish(); void refresh(); }
          if (msg.error) { socket.close(); continue; }
          if (msg.push?.channel === 'public:all@price' && msg.push.pub?.data) {
            apply(msg.push.pub.data, 'wallex_websocket', new Set(approved().markets.map(m => m.symbol))); publish();
          }
        } catch { /* Ignore malformed public frames; REST remains available. */ }
      }
    });
    socket.on('error', () => { socketConnected = false; });
    socket.on('close', () => {
      socketConnected = false; publish();
      if (!stopped) { reconnect = setTimeout(connect, retry); retry = Math.min(retry * 2, 30000); }
    });
  }
  void refresh(); if(config.wallex.wsEnabled)connect();
  // Full REST snapshots seed every market and recover changes missed during disconnects.
  restTimer = setInterval(() => { if(socket?.readyState===WebSocket.OPEN&&Date.now()-lastFrameAt>45000)socket.terminate();void refresh(); publish(); }, 5000);
  return { snapshot, stop() { stopped = true; clearInterval(restTimer); clearTimeout(reconnect); clearTimeout(publishTimer); socket?.terminate(); } };
}
