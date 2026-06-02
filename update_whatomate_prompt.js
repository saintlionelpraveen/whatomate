const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5433', 10),
    user: process.env.POSTGRES_USER || 'whatomate',
    password: process.env.POSTGRES_PASSWORD || 'whatomate',
    database: process.env.POSTGRES_DB || 'whatomate',
});

async function run() {
    try {
        const newStaticContent = `This API fetch provides JSON data from the 'Whatomate' system (customer orders). 
STRICT CONVERSATION RULES:
1. If the user just says a general trigger word like "Whatomate" or "records", DO NOT list all the records. Instead, give a warm greeting and ask them what specifically they want to check. (Example: "Hello! 👋 I have the Whatomate records open. Which customer or order would you like to check?")
2. If the user asks about a specific customer or order (e.g., "status of praveen"), look at the JSON data and answer ONLY their specific question. Keep it concise.
3. If the user ends the conversation (e.g., says "thank you", "thanks", "ok", or "bye"), give a warm closing greeting. (Example: "You're very welcome! Let me know if you need to check anything else. Have a great day! 😊")`;

        await pool.query(`
            UPDATE ai_contexts 
            SET static_content = $1
            WHERE name = 'Frappe Whatomate Resource'
        `, [newStaticContent]);
        
        console.log("Successfully updated Frappe Whatomate Resource prompt to be conversational.");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}

run();
