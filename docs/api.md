# قرارداد API محلی و WebSocket

پایه: `http://localhost:3000`. مرورگر کلید والکس/LLM را ارسال نمی‌کند؛ سرور از تنظیمات خصوصی استفاده می‌کند. این API اینترنتی چندکاربره نیست. مسیرهای زندهٔ حساس hostname محلی و JSON و، در صورت وجود Origin، هم‌مبدأ بودن را بررسی می‌کنند؛ این‌ها جایگزین احراز هویت عمومی نیستند.

همهٔ مبالغ TMN، نمادها بدون slash، کندل‌ها UTC ثانیه‌ای‌اند. شناسهٔ حساب با client_id سفارش متفاوت است. برای اطلاعات دقیق پاسخ، سرویس و تست متناظر مرجع‌اند؛ API نسخه‌بندی‌شدهٔ پایدار بیرونی اعلام نشده است.

## وضعیت و داده

| روش و مسیر | کاربرد |
| --- | --- |
| GET /api/status | قابلیت‌ها و وضعیت کلی؛ `liveTradingEnabled` فقط پرچم محیط قدیمی نیست |
| GET /api/markets | بازارهای مجاز، قیمت و سلامت جریان |
| GET /api/live-candles?symbol=BTCTMN&minutes=1 | نمودار ارز فعال؛ minutes یکی از 1،5،15،60 |
| GET /api/services | metadata غیرحساس سرویس |
| POST /api/services/wallex/test | تست خواندنی والکس، بدون سفارش |
| POST /api/services/llm/test | تست مدل؛ ممکن است هزینه داشته باشد |
| POST /api/pause | endpoint قدیمی؛ جایگزین توقف موتور جلسه نیست |

## مخزن دانش

| روش و مسیر | کاربرد |
| --- | --- |
| GET /api/knowledge | ارزها، پوشش، اسناد، jobs و وضعیت حافظه |
| GET /api/knowledge/:symbol/plan?days=30 | برنامهٔ دریافت افزایشی |
| POST /api/knowledge/:symbol/preferences | ذخیرهٔ enabled، tradeType=spot و notes |
| POST /api/knowledge/:symbol/jobs | ساخت job با kind=history یا embedding و days=1..365 |
| POST /api/knowledge/jobs/:id/cancel | قطع job مربوط |
| GET /api/knowledge/:symbol/documents | نمونهٔ اسناد آماده |

نمونهٔ body تنظیم مشارکت؛ به‌تنهایی سفارش ایجاد نمی‌کند:

```json
{"enabled":true,"tradeType":"spot","notes":"یادداشت مستقل از شواهد بازار"}
```

## پیشنهاد و دفتر سفارش

پایهٔ ترجیحی `/api/review` است؛ `/api/live` alias همان router است.

| روش و پسوند | کاربرد |
| --- | --- |
| GET / | ارزهای فعال و قابلیت سفارش |
| GET /mcp/status | سلامت MCP خواندنی |
| GET /orders | سفارش‌ها و وضعیت جلسهٔ حفاظتی |
| GET /reviews | تحلیل‌های آخرین جلسه |
| GET /reviews?sessionId=... | تحلیل‌های جلسهٔ مشخص |
| GET /reviews/:id | input/output و مصرف برای ممیزی؛ دادهٔ خصوصی |
| GET /positions | مسیر سازگاری تعهدی؛ در سیاست اسپات فهرست خالی |
| POST /constraints | حدود حساب/بازار؛ در سیاست فعلی marginAvailable=false |
| POST /history/sync | همگام‌سازی افزایشی آرایهٔ symbols |
| POST /propose | ساخت تصمیم و پیش‌نویس؛ به‌تنهایی POST تأیید کاربر نیست |
| POST /draft | پیش‌نویس دستی قابل بررسی |
| POST /orders/:id/refresh | بازبینی پیش‌نویس ارسال‌نشده |
| POST /orders/:id/confirm | ارسال همان پیش‌نویس با اختیار تأیید کاربر |
| POST /orders/:id/reconcile | خواندن وضعیت از صرافی، نه ثبت دوباره |
| POST /orders/:id/cancel | کنارگذاشتن draft یا لغو باقیماندهٔ اسپات |

confirm نیازمند `acknowledgeRealMoney=true`، `quoteHash` و `confirmationToken` همان draft و در مهلت آن است. مقدار token و hash را در issue/دمو منتشر نکنید. خودکار از سیاست ثبت‌شدهٔ جلسه اختیار می‌گیرد، نه token ساختگیِ تأیید انسان.

## جلسهٔ زنده

| روش | مسیر | کاربرد |
| --- | --- | --- |
| GET | /api/review/monitor | آخرین جلسه و state |
| POST | /api/review/monitor/start | آغاز صریح جلسه |
| POST | /api/review/monitor/stop | توقف پایش و ابطال draft ارسال‌نشده؛ موقعیت را نمی‌بندد |

فیلدهای start:

| فیلد | قرارداد |
| --- | --- |
| symbols | آرایهٔ یکتا، فعال و مجاز، ۱ تا ۳۰ نماد |
| amountTmn | بودجهٔ مثبت و در محدودهٔ سرمایه |
| kind | در چالش spot |
| entryMode | limit یا market؛ market نام مسیر سریع است و لزوماً نوع نهایی صرافی نیست |
| bestAvailable | انتخاب رتبه‌بندی؛ برای local باید true باشد |
| decisionEngine | local یا model؛ local فقط در مسیر سریعِ bestAvailable |
| riskLevel | عدد صحیح ۱ تا ۱۰ |
| maxAllocationPercent | سهم ارز، بیش از صفر و حداکثر ۵۰ |
| approvalSeconds | عدد صحیح ۱۵ تا ۳۰۰ |
| maxSlippageBps | از ۱ تا ۱۰۰ |
| executionMode | review یا automatic |
| acknowledgeAutomaticExecution | برای automatic باید true باشد |
| autoDurationMinutes | مجوز خودکار، ۱ تا ۱۰۰۸۰ دقیقه |
| autoMaxEntries | ۱ تا ۱۰۰ ورود |
| autoMaxLossPercent | ۰٫۱ تا ۱۰ درصد بودجه |

این جدول دستور شروع معامله با پارامتر پیش‌فرض نیست؛ کاربر باید تنظیمات متناسب با حساب را تأیید کند. موتور local با تنظیم ناقص یا تلاش برای تغییر موتور جلسه به مدل، fail-closed می‌شود.

## بک‌تست

پایه `/api/agent`:

| روش و پسوند | کاربرد |
| --- | --- |
| GET / | اجراها، ارزها و بودجهٔ مدل |
| GET /account | موجودی حساب و منحنی snapshots |
| POST /account/refresh | دریافت خواندنی تازه |
| GET /playbook | راهنمای تحلیلی |
| GET /trades | دفتر معاملات شبیه‌سازی |
| POST /assessment | ارزیابی تناسب سناریو قبل از شروع |
| GET /context | سلامت پوشش خبر/عمق |
| POST /context/refresh | تازه‌سازی شواهد بیرونی |
| POST /runs | ایجاد بک‌تست؛ این endpoint اجرای زنده نیست |
| GET /runs/:id | snapshot اجرا |
| GET /runs/:id/audit | ورودی، خروجی، hash، معامله و رویداد |
| POST /runs/:id/:action | pause، resume یا cancel |
| DELETE /runs/:id | حذف اجرای بک‌تستِ پایان‌یافته |

body بک‌تست `mode=backtest`، symbols، from با ISO timezone، durationMinutes، targetPercent و risk دارد. **risk این API index داخلی ۰ تا ۹ است**؛ riskLevel جلسهٔ زنده ۱ تا ۱۰ است. دادهٔ کافی، پوشش و warm-up پیش از اجرا کنترل می‌شوند. purpose می‌تواند strategy یا execution_check باشد؛ دومی ارزیابی سودآوری نیست.

## WebSocket

مسیر `/ws` مشترک است: `market_state`، `heartbeat`، `live_monitor_update`، `live_reviews_update`، `live_orders_update` و `agent_update`. همهٔ پیام‌ها schema یکسان ندارند؛ به فیلد type نگاه کنید. بخشی از پیام‌ها اعلان به‌روزرسانی‌اند و کلاینت جزئیات را دوباره GET می‌کند.

برای انتخاب بک‌تست:

```json
{"type":"agent_subscribe","runId":1}
```

runId=null آخرین snapshot را دنبال می‌کند. قطع اتصال به معنی توقف سرور نیست؛ بعد از reconnect snapshot تازه بگیرید.

## خطا

بدنهٔ رایج `{"message":"..."}` است. HTTP محلی ممکن است با کد upstream فرق کند؛ «والکس 422» می‌تواند در message یک خطای محلی بازگردد. 400 اعتبار ورودی، 403 اختیار، 409 تعارض/انقضا و 502 دادهٔ upstream در مسیرهای مربوط استفاده می‌شوند. برای unknown هیچ retry خودکار ثبت سفارش نسازید.
