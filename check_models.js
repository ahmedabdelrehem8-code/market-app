// check_models.js
// الكود ده عشان نعرف أسماء الموديلات المتاحة لمفتاحك
const apiKey = "AIzaSyAGkSigj3PM6IVqB3tyANXNLlgnh8teFZM"; // 🔴 ده مفتاحك اللي كان في الصورة

async function getAvailableModels() {
  console.log("🔍 جاري الاتصال بجوجل لمعرفة القائمة...");
  
  try {
    // بنكلم الرابط المباشر للقائمة
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await response.json();

    if (data.models) {
      console.log("\n✅ الموديلات المتاحة ليك هي:");
      data.models.forEach(model => {
        // بنعرض بس الموديلات اللي ينفع نستخدمها في التوليد (generateContent)
        if (model.supportedGenerationMethods.includes("generateContent")) {
          console.log(`- ${model.name.replace("models/", "")}`); 
        }
      });
      console.log("\n💡 خد أي اسم من دول وحطه في server.js");
    } else {
      console.log("❌ لم يتم العثور على موديلات. تأكد من المفتاح.");
      console.log(data);
    }
  } catch (error) {
    console.error("حدث خطأ:", error);
  }
}

getAvailableModels();