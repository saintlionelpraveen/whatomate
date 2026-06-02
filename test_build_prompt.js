const aiService = require('./src/services/openaiService');

async function run() {
    const settings = await aiService._getSettings();
    const prompt = await aiService._buildSystemPrompt(settings, "What is the gold rate?");
    console.log("=== GENERATED SYSTEM PROMPT ===");
    console.log(prompt);
}

run().then(() => process.exit(0)).catch(console.error);
