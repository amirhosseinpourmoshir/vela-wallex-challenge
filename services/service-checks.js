import { Router } from 'express';

const descriptions = {
  wallex: { name: 'والکس', detail: 'بررسی کلید با دریافت خواندنی کارمزد حساب؛ بدون ثبت سفارش.' },
  llm: { name: 'BoxAPI', detail: 'یک درخواست کوتاه به مدل انتخاب‌شده؛ ممکن است هزینهٔ اندکی داشته باشد.' },
};

export function serviceMetadata(config) {
  return [
    { id: 'wallex', ...descriptions.wallex, configured: Boolean(config.wallex.apiKey), endpoint: config.wallex.baseUrl, model: null },
    { id: 'llm', ...descriptions.llm, configured: Boolean(config.llm.apiKey && config.llm.baseUrl && config.llm.model), endpoint: config.llm.baseUrl, model: config.llm.model || null },
  ];
}

function httpMessage(status) {
  if (status === 401) return 'کلید API نامعتبر یا منقضی است.';
  if (status === 402) return 'اعتبار سرویس کافی نیست؛ موجودی حساب سرویس را بررسی کنید.';
  if (status === 403) return 'دسترسی رد شد؛ مجوز کلید یا محدودیت IP را بررسی کنید.';
  if (status === 404) return 'مسیر سرویس یا مدل پیدا نشد؛ آدرس و شناسهٔ مدل را بررسی کنید.';
  if (status === 429) return 'سقف درخواست یا سهمیهٔ سرویس پر شده است؛ کمی بعد تلاش کنید.';
  if (status === 400 || status === 422) return 'سرویس درخواست را نپذیرفت؛ سازگاری مدل و پارامترها باید بررسی شود.';
  return status >= 500 ? 'سرویس مقصد موقتاً خطا دارد.' : 'پاسخ موفق از سرویس دریافت نشد.';
}

export async function checkService(id, config, fetchImpl = fetch) {
  const metadata = serviceMetadata(config).find(s => s.id === id);
  if (!metadata) throw new Error('Unknown service');
  const start = performance.now();
  const finish = (ok, message, extra = {}) => ({ service: id, ok, message, checkedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - start), ...extra });
  if (!metadata.configured) return finish(false, 'تنظیمات این سرویس کامل نیست؛ فایل .env را تکمیل و سرور را مجدداً اجرا کنید.', { code: 'NOT_CONFIGURED' });
  const isLlm = id === 'llm';
  // Fixed server-side destinations only; never accept a key, URL or prompt from the browser.
  if (isLlm && config.llm.baseUrl !== 'https://ai.boxapi.ir/ai/v1') return finish(false, 'این تست فقط برای آدرس تأییدشدهٔ BoxAPI فعال است.', { code: 'UNSUPPORTED_ENDPOINT' });
  try {
    const response = await fetchImpl(isLlm ? `${config.llm.baseUrl}/chat/completions` : `${config.wallex.baseUrl}/v1/account/fee`, {
      method: isLlm ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(isLlm ? config.llm.httpTimeoutMs : config.wallex.httpTimeoutMs),
      headers: isLlm
        ? { 'Content-Type': 'application/json', Authorization: `Bearer ${config.llm.apiKey}` }
        : { 'Content-Type': 'application/json', 'x-api-key': config.wallex.apiKey },
      ...(isLlm ? { body: JSON.stringify({ model: config.llm.model, messages: [{ role: 'user', content: 'Connection test. Reply with the single word OK.' }], max_completion_tokens: 64, reasoning_effort: 'none', stream: false }) } : {}),
    });
    if (!response.ok) {
      // Never forward provider bodies: they can echo credentials or account details.
      await response.body?.cancel();
      return finish(false, httpMessage(response.status), { code: 'UPSTREAM_HTTP_ERROR', httpStatus: response.status });
    }
    let data;
    try { data = await response.json(); } catch { return finish(false, 'پاسخ سرویس JSON معتبر نیست.', { code: 'INVALID_RESPONSE', httpStatus: response.status }); }
    if (isLlm) {
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) return finish(false, 'پاسخ متنی از مدل دریافت نشد؛ سازگاری مدل یا سقف توکن نیاز به بررسی دارد.', { code: 'INVALID_RESPONSE', httpStatus: response.status });
      return finish(true, 'مدل با موفقیت پاسخ متنی تولید کرد.', { httpStatus: response.status, model: config.llm.model });
    }
    if (data?.success !== true || !data.result || typeof data.result !== 'object' || Array.isArray(data.result)) return finish(false, 'ساختار پاسخ حساب مورد انتظار نیست؛ اتصال تأیید نشد.', { code: 'INVALID_RESPONSE', httpStatus: response.status });
    return finish(true, 'کلید پذیرفته شد و اطلاعات کارمزد حساب دریافت شد. مجوز معامله و حساب چالش با این تست تأیید نمی‌شود.', { httpStatus: response.status });
  } catch (error) {
    return finish(false, ['TimeoutError', 'AbortError'].includes(error.name) ? 'زمان انتظار پایان یافت؛ اتصال یا تأخیر سرویس را بررسی کنید.' : 'اتصال شبکه، DNS یا TLS برقرار نشد.', { code: ['TimeoutError', 'AbortError'].includes(error.name) ? 'TIMEOUT' : 'NETWORK_ERROR' });
  }
}

export function serviceChecksRouter(config) {
  const router = Router();
  const pending = new Set();
  const lastCheck = new Map();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)) return res.status(403).json({ message: 'فقط دسترسی محلی مجاز است.' });
    if (req.method === 'POST') {
      if (!req.is('application/json')) return res.status(415).json({ message: 'بدنه باید JSON باشد.' });
      if (req.get('origin') && req.get('origin') !== `http://${req.get('host')}`) return res.status(403).json({ message: 'درخواست باید از همین پنل ارسال شود.' });
    }
    next();
  });
  router.get('/', (_, res) => res.json({ services: serviceMetadata(config) }));
  router.post('/:id/test', async (req, res) => {
    const id = req.params.id;
    if (!['wallex', 'llm'].includes(id)) return res.status(404).json({ message: 'سرویس پیدا نشد.' });
    if (pending.has(id) || Date.now() - (lastCheck.get(id) || 0) < 10000) return res.status(429).json({ message: 'برای تست مجدد این سرویس حداقل ۱۰ ثانیه صبر کنید.' });
    pending.add(id);
    lastCheck.set(id, Date.now());
    try { res.json(await checkService(id, config)); } finally { pending.delete(id); }
  });
  return router;
}
