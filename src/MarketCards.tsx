import { useState, type CSSProperties } from 'react';
import { Search, ArrowUpLeft, Activity, Waves, ArrowDownLeft, Database } from 'lucide-react';
import { useMarkets, type Market } from './useMarkets';

const colors=['#a3edc1','#a7b8f3','#f3c489','#eaa6bf','#a9dedf'];
export default function MarketCards({compact=false}:{compact?:boolean}) {
  const {data,error,now}=useMarkets();
  const [query,setQuery]=useState(''),[sort,setSort]=useState('name');
  const rows=(data?.markets||[]).filter(m=>`${m.name} ${m.symbol}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>sort==='gain'?(b.change24h||0)-(a.change24h||0):sort==='loss'?(a.change24h||0)-(b.change24h||0):a.symbol.localeCompare(b.symbol));
  const isFresh=(m:Market)=>!m.stale&&now-Date.parse(m.updatedAt)<20000;
  const freshCount=(data?.markets||[]).filter(isFresh).length;
  return <section className="market-experience">
    <div className="market-hero"><div className="market-hero-copy"><span className="market-caption"><Waves size={15}/> همراه جریان بازار</span><h2>بازار بیدار است.<br/><em>با وضوح دنبال کن.</em></h2><p>قیمت زندهٔ بازارهای تعهدی تومانی، در یک قاب روشن.</p><div className="market-mini-stats"><span><strong>{data?data.markets.length.toLocaleString('fa-IR'):'—'}</strong> بازار مجاز</span><span><strong>{data?data.markets.filter(m=>isFresh(m)&&(m.change24h||0)>0).length.toLocaleString('fa-IR'):'—'}</strong> صعودی</span><span><strong>{data?data.markets.filter(m=>isFresh(m)&&(m.change24h||0)<0).length.toLocaleString('fa-IR'):'—'}</strong> نزولی</span></div></div><div className="market-sculpture" aria-hidden="true"><i/><i/><i/><img src="/vela-whale.png" alt=""/><span><Activity size={15}/> جریان قیمت</span></div><div className="live-pill"><span className={freshCount?'pulse-dot':''}/>{data?.live?.socketConnected&&freshCount?'جریان زنده متصل':freshCount?'همگام‌سازی قیمت':'در حال اتصال'}<small>{freshCount.toLocaleString('fa-IR')} / {(data?.markets.length||0).toLocaleString('fa-IR')} قیمت تازه</small></div></div>
    <div className="market-toolbar"><div className="search"><Search size={17}/><input aria-label="جست‌وجوی بازار تعهدی" placeholder="ارز مورد نظرت را پیدا کن…" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="periods">{[['name','همهٔ بازارها'],['gain','بیشترین رشد'],['loss','بیشترین افت']].map(([id,label])=><button className={sort===id?'selected':''} key={id} onClick={()=>setSort(id)}>{label}</button>)}</div><span className="margin-only"><Activity size={14}/>تعهدی / TMN</span></div>
    {error&&<p className="catalog-warning" role="alert">{error}</p>}
    {!data?.ready&&<p className="catalog-warning">{data?.message||'در حال دریافت بازارهای تعهدی…'}</p>}
    <div className={`coin-cards ${compact?'compact':''}`}>{(compact?rows.slice(0,6):rows).map((m,i)=>{
      const fresh=isFresh(m),valid=Number.isFinite(Number(m.price))&&Number(m.price)>0,positive=(m.change24h||0)>=0;
      return <article className={`coin-card ${fresh?'fresh':'stale'} ${positive?'coin-rising':'coin-falling'}`} key={m.symbol} style={{'--coin-accent':colors[(data?.markets.findIndex(c=>c.symbol===m.symbol)||0)%colors.length],'--card-order':Math.min(i,8)} as CSSProperties}>
        <div className="coin-card-heading"><span className="coin-monogram">{m.base==='BTC'?'₿':m.base==='ETH'?'Ξ':m.base.slice(0,2)}</span><div><h3>{m.name}</h3><span dir="ltr">{m.base} / TMN</span></div><span className="coin-type">تعهدی</span></div>
        <div className="coin-card-price" key={m.price}>{valid?Number(m.price).toLocaleString('fa-IR',{maximumFractionDigits:Math.min(m.pricePrecision,8)}):'—'} <small>تومان</small></div>
        <div className="coin-card-change"><span className={positive?'mint':'negative'}>{positive?<ArrowUpLeft size={16}/>:<ArrowDownLeft size={16}/>}<b dir="ltr">{m.change24h===null?'—':`${positive?'+':''}${m.change24h.toLocaleString('fa-IR',{maximumFractionDigits:2})}٪`}</b></span><small>تغییر ۲۴ ساعت</small></div>
        <div className="coin-card-bottom"><span className={fresh?'quote-fresh':'quote-old'}><i/>{fresh?'قیمت تازه':'دادهٔ قدیمی / در انتظار'}</span><time>{m.updatedAt?new Date(m.updatedAt).toLocaleTimeString('fa-IR',{timeZone:'Asia/Tehran'}):'—'}</time></div>
        <span className="coin-card-watermark" aria-hidden="true">{m.base}</span>
      </article>;
    })}</div>
    {data?.ready&&!rows.length&&<p className="catalog-warning">بازار تعهدی مجازی با این نام پیدا نشد.</p>}
    <div className="market-source-note"><Database size={13}/><span>قیمت مستقیم والکس · وب‌سوکت + همگام‌سازی پشتیبان هر ۵ ثانیه · قیمت قدیمی با نشان هشدار مشخص می‌شود.</span></div>
    {data?.sync?.warning&&<details className="market-scope-note"><summary>وضعیت دسترسی حساب چالش و محدودهٔ بازارها</summary><p>{data.sync.warning} پشتیبانی عمومی تعهدی به‌تنهایی به معنی مجاز بودن آن در حساب اعتباری چالش نیست.</p></details>}
  </section>;
}
