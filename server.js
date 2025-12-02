// server.js (النسخة النهائية: الحارس الذكي + التايم أوت + بدون حذف)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // المكتبة الجديدة
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '.')));

// 1. الاتصال بقاعدة البيانات السحابية
// سيأخذ الرابط من إعدادات Render مباشرة
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // ضروري عشان الاتصال المشفر
  }
});

// التأكد من وجود الجدول (لو مش موجود ينشئه)
pool.query(`
  CREATE TABLE IF NOT EXISTS studies (
    id SERIAL PRIMARY KEY,
    activity_name TEXT UNIQUE,
    content TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`).then(() => console.log('✅ تم الاتصال بقاعدة البيانات السحابية بنجاح.'))
  .catch(err => console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err));

// 2. إعداد المفاتيح
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const googleModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// 3. دالة توحيد الاسم (المعدلة: الحارس الذكي)
async function getStandardName(userInput) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", 
      messages: [
        { 
            role: "system", 
            content: `
            أنت خبير تصنيف اقتصادي صارم. مهمتك هي تحليل مدخلات المستخدم:
            
            1. **تحقق أولاً**: هل هذا نشاط اقتصادي/تجاري حقيقي؟
               - إذا كان المدخل عبثاً، سياسة، رياضة، شتائم، أو كلام عام (مثال: "حب"، "لعب كورة"، "نكتة") -> رد بكلمة: "REFUSED" فقط.
            
            2. **إذا كان نشاطاً حقيقياً**: قم بتوحيد الاسم مع **الحفاظ الصارم على نوع القطاع**:
               - لو "تجارة/محل" -> تظل "تجارة" (مثال: "محل ملابس" -> "تجارة الملابس الجاهزة بالتجزئة"). **ممنوع تحويلها لصناعة**.
               - لو "زراعة/مزرعة" -> تظل "انتاج حيواني/زراعي" (مثال: "مزرعة مواشي" -> "تسمين الماشية والإنتاج الحيواني"). **ممنوع تحويلها لمصنع لحوم**.
               - لو "صناعة/مصنع" -> تظل "صناعة".
            
            الرد يكون الاسم الرسمي فقط بدون أي مقدمات.
            ` 
        },
        { role: "user", content: userInput }
      ],
      temperature: 0.0,
    });
    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("OpenAI Error:", error);
    return userInput; 
  }
}

app.post('/generate-study', async (req, res) => {
  let userActivity = req.body.activity;
  console.log(`🔍 جاري البحث عن: ${userActivity}`);

  try {
    // 1️⃣ توحيد الاسم (مع الحارس الذكي)
    const standardName = await getStandardName(userActivity);
    
    // 🛑 فحص الرفض: لو الحارس قال REFUSED نوقف هنا
    if (standardName === "REFUSED") {
        console.log("⛔ تم رفض البحث: نشاط غير صالح.");
        return res.status(400).json({ 
            error: "عفواً، هذا لا يبدو كاسم نشاط تجاري أو صناعي صحيح. يرجى إدخال اسم مشروع واضح." 
        });
    }

    console.log(`✅ الاسم الموحد: ${standardName}`);

    // 2️⃣ البحث في قاعدة البيانات السحابية (Neon)
    const dbCheck = await pool.query("SELECT * FROM studies WHERE activity_name = $1", [standardName]);

    if (dbCheck.rows.length > 0) {
      console.log("💰 الدراسة موجودة في الأرشيف السحابي.");
      return res.json({ result: dbCheck.rows[0].content, source: "archive", official_name: standardName });
    }

    console.log("⚡ جاري الإنشاء باستخدام Google Gemini...");
    
    // 3️⃣ الإنشاء بـ Gemini (تم تعديل البرومبت ليحترم التخصص)
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
    const cleanContent = studyContent.replace(/```html/g, '').replace(/```/g, '');

    // 4️⃣ الحفظ في Neon
    await pool.query(
      "INSERT INTO studies (activity_name, content) VALUES ($1, $2)",
      [standardName, cleanContent]
    );

    res.json({ result: cleanContent, source: "ai", official_name: standardName });

  } catch (error) {
    console.error("🔥 خطأ:", error);
    res.status(500).json({ error: "حدث خطأ أثناء المعالجة", details: error.message });
  }
});

// استرجاع الأرشيف بالكامل
app.get('/all-studies', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM studies ORDER BY id DESC");
        res.json({ studies: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "فشل تحميل الأرشيف" });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
// 👇 التعديل الأخير: حفظنا السيرفر في متغير عشان نزود الوقت
const server = app.listen(PORT, () => console.log(`🚀 السيرفر يعمل ومتصل بقاعدة البيانات`));
server.setTimeout(300000); // 5 دقائق مهلة (عشان السيرفر ميفصلش في وشك)