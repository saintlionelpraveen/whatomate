const aiService = require('./src/services/openaiService');
const express = require('express');

const app = express();
app.get('/api/gold-rate', (req, res) => {
    res.json({ success: true, rates: { USD: 2345.5, INR: 72150.0 } });
});

const server = app.listen(8081, async () => {
    // Override the config URL just for this test
    const { Pool } = require('pg');
    const pool = new Pool({
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '5433', 10),
        user: process.env.POSTGRES_USER || 'whatomate',
        password: process.env.POSTGRES_PASSWORD || 'whatomate',
        database: process.env.POSTGRES_DB || 'whatomate',
    });
    
    // Temporarily point it to 8081
    await pool.query("UPDATE ai_contexts SET api_config = '{\"url\": \"http://127.0.0.1:8081/api/gold-rate\"}' WHERE name = 'Live Gold Rate'");
    
    aiService.clearCache();
    const settings = await aiService._getSettings();
    const prompt = await aiService._buildSystemPrompt(settings, "What is the gold rate?");
    
    console.log("=== GENERATED SYSTEM PROMPT (SUCCESS) ===");
    console.log(prompt);
    
    // Restore back to 8080
    await pool.query("UPDATE ai_contexts SET api_config = '{\"url\": \"http://127.0.0.1:8080/api/gold-rate\"}' WHERE name = 'Live Gold Rate'");
    server.close();
    pool.end();
    process.exit(0);
});
