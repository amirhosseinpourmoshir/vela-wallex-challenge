import { useEffect, useState } from 'react';
import { PlugZap, RefreshCw, CheckCircle2, XCircle, Clock3, ShieldCheck, BrainCircuit, ArrowLeftRight } from 'lucide-react';

type Service = { id: string; name: string; detail: string; configured: boolean; endpoint: string; model: string | null };
type Result = { ok: boolean; message: string; checkedAt: string; durationMs: number; httpStatus?: number; model?: string };

export default function ServiceChecks() {
  const [services, setServices] = useState<Service[]>([]);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState('');
  async function load() {
    setPageError('');
    try {
      const response = await fetch('/api/services');
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data.services)) throw new Error();
      setServices(data.services);
    } catch { setPageError('دریافت وضعیت سرویس‌ها انجام نشد. سرور را با نسخهٔ جدید مجدداً اجرا کنید.'); }
  }
  useEffect(() => { void load(); }, []);
  async function test(id: string) {
    setLoading(s => ({ ...s, [id]: true }));
    setErrors(s => ({ ...s, [id]: '' }));
    // Hide the previous result during a new check so a failed retry never looks green.
    setResults(s => { const next = { ...s }; delete next[id]; return next; });
    try {
      const response = await fetch(`/api/services/${id}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(185000) });
      const data = await response.json();
      if (!response.ok) { setErrors(s => ({ ...s, [id]: data.message || 'تست انجام نشد.' })); return; }
      setResults(s => ({ ...s, [id]: data }));
    } catch { setErrors(s => ({ ...s, [id]: 'پاسخ سرور دریافت نشد؛ وضعیت اتصال محلی را بررسی کنید.' })); }
    finally { setLoading(s => ({ ...s, [id]: false })); }
  }
  return <section className="service-checks">
    <div className="service-intro"><div className="service-intro-icon"><PlugZap size={24}/></div><div><h2>مرکز بررسی اتصال</h2><p>تست واقعی سرویس‌ها از سمت سرور، با کلیدهای فایل .env</p></div><span className="neutral-tag">فقط با درخواست شما</span></div>
    <div className="service-note"><ShieldCheck size={18}/><p>این تست‌ها سفارش خرید یا فروش ثبت نمی‌کنند. تست BoxAPI یک پیام کوتاه ارسال می‌کند و ممکن است هزینهٔ اندکی داشته باشد. وضعیت اتصال فقط مربوط به زمان آخرین تست است.</p></div>
    {pageError && <div className="service-load-error" role="alert">{pageError}<button className="outline-button" onClick={load}><RefreshCw size={14}/>تلاش دوباره</button></div>}
    <div className="service-grid">{services.map(service => {
      const result = results[service.id]; const busy = loading[service.id];
      const Icon = service.id === 'llm' ? BrainCircuit : ArrowLeftRight;
      return <article className="panel service-card" key={service.id}>
        <div className="service-card-top"><span className="service-icon"><Icon size={24}/></span><div><h2>{service.name}</h2><small>{service.id === 'llm' ? 'سرویس مدل زبانی' : 'API حساب معاملاتی'}</small></div><span className={service.configured ? 'configured-pill' : 'missing-pill'}>{service.configured ? 'تنظیمات موجود' : 'تنظیمات ناقص'}</span></div>
        <p className="service-description">{service.detail}</p>
        <div className="service-fields"><div><span>نشانی سرویس</span><code dir="ltr">{service.endpoint || 'تعیین نشده'}</code></div>{service.model && <div><span>مدل انتخابی</span><code dir="ltr">{service.model}</code></div>}<div><span>کلید API</span><span>{service.configured ? 'روی سرور تنظیم شده؛ نمایش داده نمی‌شود' : 'فایل .env را بررسی کنید'}</span></div></div>
        <div className={`service-result ${result ? result.ok ? 'success' : 'failure' : ''}`} role="status" aria-live="polite">
          {busy ? <><RefreshCw className="spin" size={20}/><div><strong>در حال بررسی اتصال…</strong><p>منتظر پاسخ سرویس هستیم.</p></div></> : errors[service.id] ? <><XCircle size={20}/><p>{errors[service.id]}</p></> : result ? <>{result.ok ? <CheckCircle2 size={20}/> : <XCircle size={20}/>}<div><strong>{result.ok ? 'اتصال تأیید شد' : 'اتصال تأیید نشد'}</strong><p>{result.message}</p><div className="service-result-meta"><span><Clock3 size={12}/>{result.durationMs.toLocaleString('fa-IR')} میلی‌ثانیه</span><span>{new Date(result.checkedAt).toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran' })} تهران</span>{result.httpStatus && <span dir="ltr">HTTP {result.httpStatus}</span>}</div></div></> : <><Clock3 size={20}/><div><strong>هنوز تست نشده</strong><p>وجود کلید به‌تنهایی به معنی اتصال موفق نیست.</p></div></>}
        </div>
        <button disabled={busy || !service.configured} className="service-test-button" onClick={() => test(service.id)}><RefreshCw size={16} className={busy ? 'spin' : ''}/>{busy ? 'در حال تست…' : service.id === 'llm' ? 'تست پاسخ مدل' : 'تست اتصال والکس'}</button>
      </article>;
    })}</div>
    <p className="service-bottom-note">پس از تغییر .env سرور را مجدداً اجرا کنید. نتیجهٔ موفق والکس، مجوز معامله یا اختصاص داشتن کلید به حساب چالش را اثبات نمی‌کند.</p>
  </section>;
}
