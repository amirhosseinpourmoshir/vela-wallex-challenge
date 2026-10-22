import { useEffect, useState } from 'react';
import { Search, ShieldCheck, RefreshCw, Database } from 'lucide-react';

type Market = { symbol: string; base: string; quote: string; name: string; price: string; change24h: number | null; amountPrecision: number; pricePrecision: number };
type Catalog = { ready: boolean; markets: Market[]; sync?: { checkedAt: string; packageId: string; packageTitle: string; warning: string }; message?: string };
export default function AllowedMarkets({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [quote, setQuote] = useState('ALL');
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true); setError('');
    try { const r = await fetch('/api/markets'); if (!r.ok) throw Error(); const d = await r.json(); if (!Array.isArray(d.markets)) throw Error(); setData(d); }
    catch { setError('فهرست معتبر دریافت نشد. سرور را بررسی کنید؛ بازار نمونه جایگزین نمی‌شود.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const rows = (data?.markets || []).filter(m => (quote === 'ALL' || m.quote === quote) && `${m.symbol} ${m.name}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="panel allowed-markets">
    <div className="panel-heading"><div><h2><ShieldCheck size={17}/>بازارهای مجاز طبق طرح والکس <span className="tiny-label">{data?.markets.length.toLocaleString('fa-IR') || '۰'} بازار</span></h2><p>فقط اسپات‌های خارج از فهرست ممنوع طرح؛ قیمت‌ها اسنپ‌شات زمان واکشی هستند.</p></div><button className="outline-button" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/>بازخوانی فهرست ذخیره‌شده</button></div>
    {error ? <p className="catalog-warning" role="alert">{error}</p> : !data?.ready ? <p className="catalog-warning">{data?.message || 'در حال دریافت فهرست…'}</p> : <>
      <div className="catalog-summary"><span><Database size={14}/>{data.sync?.packageTitle}</span><span>طرح {data.sync?.packageId}</span><span>تومانی: {data.markets.filter(m => m.quote === 'TMN').length.toLocaleString('fa-IR')}</span><span>تتری: {data.markets.filter(m => m.quote === 'USDT').length.toLocaleString('fa-IR')}</span><span>واکشی: {new Date(data.sync!.checkedAt).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' })} تهران</span></div>
      {data.sync?.warning && <p className="catalog-warning">{data.sync.warning}</p>}
      <div className="catalog-controls"><div className="search"><Search size={15}/><input aria-label="جست‌وجوی بازار مجاز" placeholder="نام ارز یا نماد بازار…" value={query} onChange={e => setQuery(e.target.value)}/></div><div className="periods">{[['ALL','همه'],['TMN','تومانی'],['USDT','تتری']].map(([value,label]) => <button key={value} className={quote===value?'selected':''} onClick={()=>setQuote(value)}>{label}</button>)}</div><span>{rows.length.toLocaleString('fa-IR')} نتیجه</span></div>
      <div className={`table-scroll catalog-table ${compact ? 'compact' : ''}`}><table><thead><tr><th>بازار</th><th>نام دارایی</th><th>قیمت اسنپ‌شات</th><th>تغییر ۲۴ ساعت</th><th>دقت مقدار / قیمت</th></tr></thead><tbody>{rows.map(m=><tr key={m.symbol}><td><strong dir="ltr">{m.base} / {m.quote}</strong></td><td>{m.name}</td><td>{Number.isFinite(Number(m.price)) && Number(m.price)>0 ? <>{Number(m.price).toLocaleString('fa-IR',{maximumFractionDigits:12})} <small>{m.quote==='TMN'?'تومان':'تتر'}</small></> : <small>قیمت معتبر موجود نیست</small>}</td><td className={(m.change24h||0)<0?'negative':'mint'} dir="ltr">{m.change24h===null?'—':m.change24h.toLocaleString('fa-IR',{maximumFractionDigits:2})+'٪'}</td><td>{m.amountPrecision.toLocaleString('fa-IR')} / {m.pricePrecision.toLocaleString('fa-IR')}</td></tr>)}</tbody></table>{!rows.length&&<p className="catalog-warning">بازاری با این جست‌وجو پیدا نشد.</p>}</div>
      <p className="catalog-footnote">به‌روزرسانی از والکس: <code dir="ltr">npm run markets:sync</code> · معاملهٔ واقعی غیرفعال است. فهرست فقط در زمان واکشی معتبر بوده و باید پیش از اجرا تازه‌سازی شود.</p>
    </>}
  </section>;
}
