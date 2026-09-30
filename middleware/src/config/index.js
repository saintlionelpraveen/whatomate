require("dotenv").config();

module.exports = {
    PORT: process.env.PORT || 8080,
    APP_ENV: process.env.APP_ENV || process.env.NODE_ENV || "development",
    WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
    WHATSAPP_PHONE_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID,
    WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || "whatomate123",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    AI_MODEL: process.env.AI_MODEL || "google/gemini-3.5-flash",
    WHATOMATE_API_URL: process.env.WHATOMATE_API_URL || "http://127.0.0.1:3000/api",
    WHATOMATE_API_KEY: process.env.WHATOMATE_API_KEY,
    WHATSAPP_ACCOUNT_NAME: process.env.WHATSAPP_ACCOUNT_NAME || "Whatomate bot",
};
 