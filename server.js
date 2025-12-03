// server.js (نسخة محسّنة)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '.')));

// 1. الاتصال بقاعدة البيانات السحابية (Neon / Render)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// التأكد من وجود الجدول
pool.query(`
  CREATE TABLE IF NOT EXISTS studies (
    id SERIAL PRIMARY KEY,
    activity_name TEXT UNIQUE,
    content TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`).then(() => console.log('✅ تم الاتصال بقاعدة البيانات السحابية وإنشاء الجدول (إن لم يكن موجوداً).'))
  .catch(err => console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err));

// 2. إعداد المفاتيح
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const googleModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

/**
 * 3. دالة توحيد الاسم (الإصدار الذكي)
 * - لا يحوّل كل شيء لصناعة.
 * - يراعي نوع النشاط (تجارة / صناعة / زراعة / خدمة) حسب ما كتبه المستخدم.
 * - لو النص مش نشاط اقتصادى واضح → يرجّع "REFUSED".
 */
async function getStandardName(userInput) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `
أنت خبير ائتمان فى بنك.
مهمتك:
1) تقرأ وصف النشاط كما كتبه المستخدم (تجارة / صناعة / زراعة / خدمة / مهن حرة).
2) لا تغيِّر نوع النشاط:
   - لو كتب "تجارة ..." يبقى النشاط تجارى.
   - لو كتب "صناعة ..." أو "مصنع" يبقى صناعي.
   - لو كتب "مزرعة" أو "زراعة" يبقى زراعي.
   - لو كتب "خدمات" أو "مركز" أو "عيادة" يبقى خدمى.
3) تعيد صياغة الاسم ليكون:
   - قصير، رسمي، وواضح بالعربية.
   - مثال:
     "تجارة الملابس الجاهزة بالتجزئة"
     "صناعة الأثاث الخشبي"
     "مزرعة لتربية المواشي"
     "مركز صيانة أجهزة كهربائية"
4) لو النص لا يبدو كنشاط اقتصادي أو مشروع (مثلاً: شتيمة، جملة بدون معنى، سؤال عام):
   - أرجِع بالضبط الكلمة التالية فقط: REFUSED

⬅ المطلوب: ارجع بالاسم الموحد فقط بدون أي شروح إضافية.
          `
        },
        { role: "user", content: userInput }
      ],
      temperature: 0.0,
    });

    const name = response.choices[0].message.content.trim();
    return name;
  } catch (error) {
    console.error("❌ خطأ في getStandardName:", error.message);
    // fallback: نرجّع نفس ما كتبه المستخدم
    return userInput;
  }
}

// نقطة إنشاء/جلب الدراسة
app.post('/generate-study', async (req, res) => {
  let userActivity = req.body.activity;
  console.log(`🔍 طلب دراسة لنشاط: ${userActivity}`);

  try {
    // 1️⃣ توحيد الاسم بنظام ذكي يحافظ على نوع النشاط
    const standardName = await getStandardName(userActivity);

    // 🛑 لو الـ Guard رجّع REFUSED
    if (standardName === "REFUSED") {
      console.log("⛔ تم رفض الطلب: النص ليس نشاطًا اقتصادياً واضحاً.");
      return res.status(400).json({
        error: "عفواً، النص المدخل لا يبدو كاسم نشاط تجاري أو صناعي أو خدمي واضح. برجاء إدخال اسم نشاط مثل: تجارة الملابس الجاهزة، صناعة البلاستيك، مزرعة مواشي..."
      });
    }

    console.log(`✅ الاسم الموحد للنشاط: ${standardName}`);

    // 2️⃣ البحث في الأرشيف (Neon) بنفس الاسم الموحد
    const dbCheck = await pool.query(
      "SELECT * FROM studies WHERE activity_name = $1",
      [standardName]
    );

    if (dbCheck.rows.length > 0) {
      console.log("📂 تمت إعادة النشاط من الأرشيف السحابي.");
      return res.json({
        result: dbCheck.rows[0].content,
        source: "archive",
        official_name: standardName
      });
    }

    console.log("⚡ لم يتم العثور في الأرشيف — سيتم إنشاء دراسة جديدة عبر Gemini...");

    // 3️⃣ إنشاء الدراسة باستخدام Gemini (مع احترام طبيعة النشاط)
    const prompt = `
      أنت مستشار ائتماني. اكتب "دراسة سوق تفصيلية" لنشاط: "${standardName}".
      
      المتطلبات:
      1. المخرج HTML فقط (h3, ul, table).
      2. اكتب باستفاضة شديدة وأرقام تقديرية.
      
      الهيكل:
      <h3>1️⃣ نظرة عامة</h3> (فقرة طويلة).
      <h3>2️⃣ المنتجات</h3> (قائمة).
      <h3>3️⃣ هيكل السوق</h3> (عدد المصانع، المنافسة).
      <h3>4️⃣ دورة التشغيل (أرقام)</h3> (جدول أيام تشغيل).
      <h3>5️⃣ التكاليف والهوامش</h3> (نسب مئوية).
      <h3>6️⃣ SWOT</h3> (تحليل كامل).
      <h3>7️⃣ التوصية</h3> (رأي ائتماني).
      `;


    const result = await googleModel.generateContent(prompt);
    const studyContent = result.response.text();

    // إزالة أى ```html أو ``` من المخرج
    const cleanContent = studyContent
      .replace(/```html/gi, '')
      .replace(/```/g, '');

    // 4️⃣ حفظ الدراسة في الأرشيف
    await pool.query(
      "INSERT INTO studies (activity_name, content) VALUES ($1, $2)",
      [standardName, cleanContent]
    );

    console.log("✅ تم حفظ الدراسة الجديدة في الأرشيف.");

    return res.json({
      result: cleanContent,
      source: "ai",
      official_name: standardName
    });

  } catch (error) {
    console.error("🔥 خطأ في /generate-study:", error);
    return res.status(500).json({
      error: "حدث خطأ أثناء إعداد الدراسة",
      details: error.message
    });
  }
});

// استرجاع الأرشيف بالكامل
app.get('/all-studies', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM studies ORDER BY id DESC"
    );
    res.json({ studies: result.rows });
  } catch (err) {
    console.error("❌ فشل تحميل الأرشيف:", err);
    res.status(500).json({ error: "فشل تحميل الأرشيف" });
  }
});

// خدمة الصفحة الرئيسية
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () =>
  console.log(`🚀 السيرفر يعمل على البورت ${PORT} ومتصل بقاعدة البيانات`)
);

// زيادة مهلة الاستجابة إلى 5 دقائق
server.setTimeout(300000);
