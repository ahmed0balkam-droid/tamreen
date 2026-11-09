# ⚽ تمرين السبت

تطبيق التسجيل الأسبوعي لتمرين كرة القدم: القائمة، توزيع الفريقين، السديري، النتيجة والأهداف، التصويت لأفضل لاعب وأفضل مدافع، الإحصائيات وبطاقة كل لاعب.

| الجزء | المكان | التقنية |
|---|---|---|
| التطبيق (PWA) | `docs/` | HTML + JS بدون مكتبات، يُستضاف على GitHub Pages |
| الخادم | `supabase/functions/api/index.ts` | Supabase Edge Function (Deno) — **مولّد** من `src/` بأمر `npm run build` |
| المنطق | `src/core.js` | كل قواعد التطبيق (نفس منطق نسخة Google Sheets) |
| قاعدة البيانات | `src/schema.sql` | PostgreSQL — 8 جداول، RLS مفعّل بدون سياسات (الوصول فقط عبر الخادم) |
| طبقة البيانات | `src/db.js` | تحميل الجداول، تشغيل المنطق، حفظ التغييرات في معاملة واحدة مع قفل |

## التطوير
```bash
npm install
npm test          # اختبارات المنطق + محاكاة أسبوعين + إعادة تشغيل كل العمليات على Postgres حقيقي (PGlite)
```
بعد أي تعديل في `src/` شغّل `npm run build` وارفع `supabase/functions/api/index.ts` للدالة `api` (JWT verification: off).

## كيف يشتغل الطلب
`POST /functions/v1/api` ← `{fn, arg}` ← قفل (advisory lock) ← تحميل الجداول ← تشغيل الدالة ← حفظ الفرق فقط ← `{data}` أو `{error}` برسالة عربية.
