# KAYRO AI

فضای کاری هوش مصنوعی فارسی‌محور مبتنی بر React، TypeScript، Vite، Cloudflare Pages Functions/Workers و D1.

## وضعیت فعلی

- هدف استقرار فعلی: فضای کاری فقط برای مالک و با TOTP در برنامهٔ Authenticator محافظت می‌شود؛ نام کاربری و رمز عبور وجود ندارد.
- تمام APIهای گفتگو، مدل‌ها و تنظیمات به نشست معتبر مالک نیاز دارند؛ مسیرهای گفتگوی ناشناس قبلی دیگر از router قابل‌دسترسی نیستند.
- نخستین راه‌اندازی با Secret یک‌بارمصرف `OWNER_SETUP_TOKEN` انجام می‌شود؛ پس از اسکن QR و تأیید کد، راه‌اندازی برای همیشه بسته می‌شود مگر اینکه رکورد TOTP در D1 عمداً حذف شود.
- کلید ارائه‌دهنده در D1 با AES-GCM رمز می‌شود و به فرانت‌اند برگردانده نمی‌شود.
- فقط مدل‌هایی که قیمت ورودی و خروجی آن‌ها از API ارائه‌دهنده صریحاً صفر گزارش شده است، در انتخاب رایگان قرار می‌گیرند. رایگان بودن به معنی تضمین ظرفیت یا دسترس‌پذیری نیست.
- سرویس حساب شخصی Telegram MTProto در پوشهٔ telegram-user-service/ مستقل از Telegram Bot API قرار دارد و تا زمان تنظیم Secretها، volume پایدار و تست ورود واقعی، نباید اتصال آن را عملیاتی فرض کرد.
- افزونهٔ مرورگر و بخشی از قابلیت‌های گستردهٔ مدیریت وظایف هنوز کامل نیستند؛ بخش ناقص را قابلیت نهایی تلقی نکنید.

## بررسی کیفیت و تست‌ها

GitHub Actions با نام **KAYRO AI CI** در push به main، Pull Request و اجرای دستی این مراحل را انجام می‌دهد:

1. نصب وابستگی‌های قفل‌شده با npm ci
2. بررسی TypeScript برای فرانت‌اند، Worker و Pages Functions
3. اجرای تست‌ها با npm test
4. build تولید با npm run build
5. ساخت artifact قابل انتشار شامل فایل‌های استاتیک و _worker.js

اجرای CI را در [GitHub Actions](https://github.com/kiarash707/AI/actions) بررسی کنید.

## استقرار Cloudflare Pages

پروژهٔ Cloudflare Pages با نام kayro-ai و دامنهٔ https://kayro-ai.pages.dev در حساب Cloudflare ثبت شده است. اتصال D1 با نام DB و شناسهٔ kayro-ai در تنظیمات Production و Preview ثبت شده است. احراز هویت TOTP در Worker انجام می‌شود؛ پس از deployment، راه‌اندازی QR و رد شدن درخواست‌های API بدون نشست را در مرورگر ناشناس آزمایش کنید.

Workflow موجود در [.github/workflows/deploy.yml](.github/workflows/deploy.yml) پس از موفقیت CI روی main، artifact همان commit را به Cloudflare Pages منتشر می‌کند. همچنین از مسیر **Actions → Deploy KAYRO AI to Cloudflare Pages → Run workflow** می‌توان استقرار دستی را اجرا کرد.

برای فعال‌شدن انتشار خودکار، این دو مقدار را در **GitHub → Settings → Secrets and variables → Actions** به‌عنوان Repository secrets تنظیم کنید:

- CLOUDFLARE_API_TOKEN: توکن محدودشده به مجوز Cloudflare Pages: Edit در حساب درست؛ از Global API Key استفاده نکنید.
- CLOUDFLARE_ACCOUNT_ID: شناسهٔ حساب Cloudflare که پروژهٔ kayro-ai در آن قرار دارد.

شناسهٔ حساب را از Cloudflare Dashboard بردارید. مقدار Secretها را در کد، issue، log یا چت قرار ندهید. اگر Secretها تنظیم نشده باشند، مرحلهٔ deploy باید با خطای روشن متوقف شود؛ سبزشدن CI به معنی انتشار نیست.

روش اتصال مستقیم Git به پروژهٔ Pages از طریق API در حال حاضر با خطای احراز اتصال Git در Cloudflare رد شد. Workflow بالا از artifact تأییدشدهٔ GitHub برای Direct Upload استفاده می‌کند؛ این مسیر تا زمانی که Cloudflare Git integration دوباره مجاز نشود، روش استقرار خودکار تعریف‌شده است.

### پس از انتشار بررسی کنید

- سایت: [https://kayro-ai.pages.dev](https://kayro-ai.pages.dev)
- سلامت API و D1: [https://kayro-ai.pages.dev/api/health](https://kayro-ai.pages.dev/api/health)
- وضعیت deployment و logها: [Cloudflare Dashboard → Workers & Pages → kayro-ai](https://dash.cloudflare.com/)

Health endpoint باید ok: true و database: "ok" برگرداند. این نتیجه باید بعد از deployment واقعی بررسی شود.

## راه‌اندازی ورود خصوصی با Authenticator

در Cloudflare → Workers & Pages → kayro-ai → Settings → Variables and Secrets، این دو مقدار را در **Production** به‌صورت Secret اضافه کنید:

- `OWNER_SETUP_TOKEN`: یک رمز تصادفی قوی با حداقل ۳۲ نویسه که فقط برای راه‌اندازی اولیه استفاده می‌شود.
- `OWNER_AUTH_ENCRYPTION_KEY`: مقدار Base64 از دقیقاً ۳۲ بایت تصادفی؛ برای رمزگذاری کلید TOTP مالک استفاده می‌شود. این کلید باید ثابت بماند.

پس از انتشار، سایت را باز کنید، `OWNER_SETUP_TOKEN` را یک‌بار وارد کنید، QR را با برنامهٔ Authenticator اسکن کنید و کد شش‌رقمی را تأیید کنید. بعد از موفقیت، Secret `OWNER_SETUP_TOKEN` را از Cloudflare حذف کنید. هر نشست ۱۲ ساعت اعتبار دارد و خروج امن در رابط کاربری موجود است. QR فقط هنگام راه‌اندازی اولیه نمایش داده می‌شود؛ آن را ذخیره یا با دیگران به اشتراک نگذارید.

**مهم:** اگر `OWNER_AUTH_ENCRYPTION_KEY` را گم یا عوض کنید، کلید TOTP ذخیره‌شده قابل رمزگشایی نیست و ورود نیاز به بازیابی دستی در D1 خواهد داشت. Secretها را در GitHub یا چت قرار ندهید. برای بازنشانی، قبل از حذف تنظیمات TOTP یک روش بازیابی امن داشته باشید.

## تنظیم هوش مصنوعی

1. سایت را باز کنید و به بخش «هوش مصنوعی و API» بروید.
2. برای ورود از کد شش‌رقمی برنامهٔ Authenticator استفاده کنید.
3. پس از ورود، یک کلید OpenRouter را فقط در فرم امن سایت وارد کنید، اتصال را آزمایش کنید و ذخیره کنید.
4. فهرست مدل‌ها باید فقط مدل‌هایی با قیمت ورودی و خروجی صفر را نمایش دهد.

Secret رمزنگاری سمت سرور با نام AI_CREDENTIALS_ENCRYPTION_KEY باید در تنظیمات Production و Preview Cloudflare به‌صورت Secret تنظیم شود و مقدار آن Base64 از ۳۲ بایت تصادفی باشد. این Secret هنوز باید از داشبورد Pages اضافه و ذخیره شود؛ بدون آن ذخیره و بازیابی امن کلید AI شکست می‌خورد. اگر این Secret خالی یا نامعتبر باشد، ذخیره و بازیابی امن کلید هوش مصنوعی کار نخواهد کرد.

## زبان رابط کاربری

نسخهٔ فعلی رابط هنوز عمدتاً فارسی است و پشتیبانی کامل دوزبانهٔ تمام صفحه‌ها هنوز تکمیل نشده است. این مورد را نباید به‌عنوان قابلیت تکمیل‌شده اعلام کرد.

## اتصال حساب شخصی تلگرام (MTProto)

این قابلیت با Telegram Bot API یکی نیست. سرویس خصوصی در telegram-user-service/ از Telethon استفاده می‌کند و باید روی میزبان پایدار با volume خصوصی اجرا شود. حداقل متغیرهای آن:

- TELEGRAM_API_ID
- TELEGRAM_API_HASH
- KAYRO_BRIDGE_SECRET (حداقل ۳۲ نویسهٔ تصادفی)
- TELEGRAM_SESSION_DIR (پوشه‌ای روی volume پایدار، معمولاً /data)

در Cloudflare Pages نیز متغیرهای TELEGRAM_USER_SERVICE_URL و TELEGRAM_USER_SERVICE_SECRET باید به‌صورت امن تنظیم شوند و Secret پل باید با KAYRO_BRIDGE_SECRET یکسان باشد. از HTTPS استفاده کنید. کد ورود، رمز دومرحله‌ای و فایل session را در Git یا log قرار ندهید.

تا وقتی این متغیرها و volume تنظیم نشده‌اند و ورود واقعی حساب، فهرست گفتگوها، تاریخچه و ارسال پیام با تأیید مالک آزمایش نشده است، اتصال تلگرام را عملیاتی تلقی نکنید.

## توسعهٔ محلی

```bash
npm ci
npm run check
npm test
npm run build
npm run dev
```

برای اجرای API محلی با D1 به پیکربندی Wrangler و bindingهای محلی مناسب نیاز است. DEV_MODE=true فقط برای محیط توسعهٔ محلی است و نباید در Production تنظیم شود.

## امنیت و محدودیت‌ها

- هرگز Secret واقعی را در GitHub commit نکنید.
- احراز هویت مالک باید در بک‌اند هم بررسی شود؛ مخفی‌کردن کنترل‌ها در رابط کاربری کافی نیست.
- D1 و Secretهای احراز هویت و رمزگذاری را بدون برنامهٔ بازیابی حذف یا جایگزین نکنید.
- CI نوع‌دهی، تست‌ها و build را بررسی می‌کند؛ تست بیرونی health، چت و اتصال واقعی تلگرام پس از استقرار همچنان لازم است.
- مدل رایگان ممکن است محدودیت نرخ، قطعی یا کمبود ظرفیت داشته باشد؛ برنامه نباید بدون اطلاع مالک به مدل پولی fallback کند.
