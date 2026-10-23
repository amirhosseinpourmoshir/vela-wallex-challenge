# SQLite و داده

مسیر پیش‌فرض `data/vela.sqlite` است؛ `SQLITE_PATH` می‌تواند تغییرش دهد. فایل دیتابیس، journal/WAL و محتویات `data/` در Git نیستند. schema در سرویس‌های مربوط با CREATE IF NOT EXISTS و تغییرات سازگار راه‌اندازی می‌شود؛ migration نسخه‌دار مستقل وجود ندارد.

## گروه جدول‌ها

| جدول‌ها | کاربرد |
| --- | --- |
| `challenge_markets`, `market_catalog_sync` | whitelist و گزارش آخرین کشف |
| `coin_preferences` | مشارکت، نوع و یادداشت هر ارز |
| `historical_candles` | OHLCV منبع/نماد/بازه/زمان |
| `history_unavailable_ranges`, `history_dirty_days` | کش پاسخ بدون داده و روز نیازمند بازسازی |
| `knowledge_documents`, `knowledge_vectors`, `knowledge_jobs` | متن، hash، بردار وابسته به مدل/ابعاد و job |
| `live_review_sessions`, `live_review_events`, `live_reviews` | تنظیمات/وضعیت جلسه، رویداد، input/output و توکن |
| `live_orders`, `live_order_events` | quote، hash تأیید، client_id، پاسخ، خطا و audit اختیار |
| `agent_runs`, `agent_memory`, `agent_decisions` | تنظیمات و حافظهٔ frozen بک‌تست، تصمیم‌های زمانی |
| `agent_entry_orders`, `agent_trades`, `agent_equity`, `agent_events` | سفارش منتظر، معامله، منحنی سرمایه و رویداد شبیه‌سازی |
| `agent_daily_budget` | فراخوانی/توکن ثبت‌شدهٔ مسیر مدل |
| `account_equity` | snapshots موجودی حساب در scope مربوط |
| `market_news`, `market_depth`, `market_context_health` | شواهد خبر/عمقِ زمان‌دار و سلامت پوشش |
| `settings` | تنظیمات قدیمی پنل؛ مجوز اصلی موتور زنده نیست |

فیلدهای margin/side/leverage برای سازگاری تاریخچه ممکن است باقی باشند؛ وجود ستون مجوز تعهدی نیست. scope اجرای حساب از تنظیمات اتصال مشتق می‌شود؛ تغییر کلید/حساب، سوابق حساب دیگر را به مجوز جاری تبدیل نمی‌کند.

## زمان، عدد و یکتایی

کندل با زمان UTC ثانیه‌ای ذخیره می‌شود؛ بسیاری از created_atهای برنامه میلی‌ثانیه‌اند. نام timestamp به‌تنهایی واحد را مشخص نمی‌کند؛ قرارداد همان سرویس را بخوانید. نمایش شمسی تبدیل رابط است. مقدار پول TMN است.

قیمت/مقدار صرافی می‌تواند رشتهٔ ده‌دهی باشد. گردکردن سفارش از stepSize/tickSize می‌آید، نه precision حسابداری دارایی. کندل، سند، job و سفارش یکتایی‌های متفاوت دارند؛ حذف تکرار کندل جایگزین کنترل client_id سفارش نیست.

## محرمانگی و پشتیبان

دیتابیس شامل حساب، ورودی/خروجی مدل، طرح معامله و پاسخ خصوصی صرافی است. audit export را پیش از انتشار پاکسازی کنید. دستور SELECT خواندنی را به‌جای تغییر مستقیم وضعیت سفارش استفاده کنید.

برای backup ساده، ابتدا وضعیت دارایی و حفاظت را بررسی، پایش را طبق نیاز متوقف و سرور را کامل خاموش کنید؛ سپس فایل را در مسیر خصوصی کپی کنید. برای backup هنگام کار باید از snapshot سازگار SQLite استفاده شود، نه کپی تصادفی فایل فعال. [عملیات](operations.md).

حذف بک‌تست فقط ردیف‌های اجرای شبیه‌سازی را پاک می‌کند؛ دفتر سفارش زنده را نباید برای رفع unknown حذف کرد.
