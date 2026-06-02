const aiService = require('./src/services/openaiService');

async function run() {
    const pgHistory = await aiService.getConversationHistory('918825607244', 5);
    console.log("PG History:", pgHistory);
}

run().then(() => process.exit(0)).catch(console.error);
