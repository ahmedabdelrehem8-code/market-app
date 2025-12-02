// server.js (النسخة النهائية المتصلة بـ Neon)
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

// 3. دالة توحيد الاسم (OpenAI)
async function getStandardName(userInput) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", 
      messages: [
        { role: "system", content: `حول هذا النشاط لاسم صناعي موحد ودقيق (مثال: "مصنع شيبسي" -> "صناعة المقرمشات الغذائية"). الرد يكون الاسم فقط.` },
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
    // 1️⃣ توحيد الاسم
    const standardName = await getStandardName(userActivity);
    console.log(`✅ الاسم الموحد: ${standardName}`);

    // 2️⃣ البحث في قاعدة البيانات السحابية (Neon)
    const dbCheck = await pool.query("SELECT * FROM studies WHERE activity_name = $1", [standardName]);

    if (dbCheck.rows.length > 0) {
      console.log("💰 الدراسة موجودة في الأرشيف السحابي.");
      return res.json({ result: dbCheck.rows[0].content, source: "archive", official_name: standardName });
    }

    console.log("⚡ جاري الإنشاء باستخدام Google Gemini...");
    
    // 3️⃣ الإنشاء بـ Gemini
    const prompt = `
      أنت مستشار ائتماني. اكتب "دراسة سوق تفصيلية" لنشاط: "${standardName}".
      المتطلبات: المخرج HTML فقط (h3, ul, table).
      الهيكل: نظرة عامة، المنتجات، هيكل السوق، دورة التشغيل، التكاليف، SWOT، التوصية.
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
app.listen(PORT, () => console.log(`🚀 السيرفر يعمل ومتصل بقاعدة البيانات`));