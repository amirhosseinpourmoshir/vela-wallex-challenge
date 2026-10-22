import { useEffect, useState } from 'react';
export type Market = { symbol: string; base: string; quote: string; name: string; price: string; change24h: number | null; amountPrecision: number; pricePrecision: number; tradeType: string; spotAvailable: boolean; marginRules: { max_risk_coef: string; min_risk_coef: string }; stale: boolean; updatedAt: string; priceSource: string };
export type Catalog = { ready: boolean; markets: Market[]; sync?: { checkedAt: string; packageTitle: string; warning: string }; live?: { socketConnected: boolean; lastRestAt: string; staleAfterMs: number }; message?: string };
export function useMarkets() {
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let stopped = false, ws: WebSocket | undefined, retry: ReturnType<typeof setTimeout>;
    function accept(d: Catalog) { if (!stopped && Array.isArray(d.markets)) { setData(d); setError(''); } }
    async function refresh() { try { const r = await fetch('/api/markets'); if (!r.ok) throw Error(); accept(await r.json()); } catch { if (!stopped) setError('ارتباط با سرور محلی قطع شده است.'); } }
    function connect() {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.onmessage = event => { try { const d = JSON.parse(event.data); if (d.type === 'market_state') accept(d); } catch { /* no-op */ } };
      ws.onclose = () => { if (!stopped) retry = setTimeout(connect, 2000); };
      ws.onerror = () => ws?.close();
    }
    void refresh(); connect();
    const poll = setInterval(() => { setNow(Date.now()); if (!ws || ws.readyState !== WebSocket.OPEN) void refresh(); }, 1000);
    return () => { stopped = true; clearInterval(poll); clearTimeout(retry); ws?.close(); };
  }, []);
  return { data, error, now };
}
