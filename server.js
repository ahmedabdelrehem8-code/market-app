// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const OpenAI = require('openai'); // بتاع الفلوس القديمة
const { GoogleGenerativeAI } = require("@google/generative-ai"); // بتاع التوفير
const path = require('path'); // 👈 1. هام جداً: استدعاء مكتبة المسارات

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '.')));
// 1. إعداد الأرشيف
const db = new sqlite3.Database('./market_archive.db', (err) => {
  if (err) console.error(err.message);
  console.log('📂 الأرشيف جاهز.');
});

db.run(`CREATE TABLE IF NOT EXISTS studies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_name TEXT UNIQUE,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// 2. إعداد المفاتيح (الاثنين مع بعض)
// مفتاح OpenAI (اللي فيه رصيد)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY // 🔴 استبدل دي بالمفتاح بتاعك لما تجيبه
});
// مفتاح Google (المجاني/الرخيص)
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const googleModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });// 🧠 3. دالة توحيد الاسم (هنستخدم فيها OpenAI عشان نحلل فلوسك)
async function getStandardName(userInput) {
  try {
    // OpenAI شاطر جداً في الفهم المنطقي القصير
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", 
      messages: [
        {
          role: "system",
          content: `حول هذا النشاط لاسم صناعي موحد ودقيق (مثال: "مصنع شيبسي" -> "صناعة المقرمشات الغذائية"). الرد يكون الاسم فقط.`
        },
        { role: "user", content: userInput }
      ],
      temperature: 0.0,
    });
    return response.choices[0].message.content.trim();
  } catch (error) {
    return userInput; 
  }
}

app.post('/generate-study', async (req, res) => {
  let userActivity = req.body.activity;
  console.log(`🔍 بحث عن: ${userActivity}`);

  // 1️⃣ خطوة OpenAI: توحيد الاسم (استهلاك بسيط جداً من الرصيد)
  const standardName = await getStandardName(userActivity);
  console.log(`✅ الاسم الموحد (OpenAI): ${standardName}`);

  // 2️⃣ البحث في الأرشيف
  db.get("SELECT * FROM studies WHERE activity_name = ?", [standardName], async (err, row) => {
    if (row) {
      console.log("💰 موجود في الأرشيف.");
      return res.json({ result: row.content, source: "archive", official_name: standardName });
    }

    console.log("⚡ جاري الكتابة باستخدام Google Gemini...");

    try {
      // 3️⃣ خطوة Google: كتابة التقرير الطويل (عشان ده أرخص بكتير في النصوص الطويلة)
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

      // حفظ في الأرشيف
      const insertSql = "INSERT INTO studies (activity_name, content) VALUES (?, ?)";
      db.run(insertSql, [standardName, cleanContent]);

      res.json({ result: cleanContent, source: "ai", official_name: standardName });

    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "حدث خطأ" });
    }
  });
});

// نقطة الأرشيف
app.get('/all-studies', (req, res) => {
    db.all("SELECT * FROM studies ORDER BY id DESC", [], (err, rows) => res.json({ studies: rows }));
});
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 السيرفر الهجين يعمل (OpenAI للمخ + Google للعضلات)'));