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
ACT LIKE A REAL HUMAN CUSTOMER SUPPORT AGENT.
1. Be extremely helpful, warm, and natural.
2. If the user just says a general trigger word like "Whatomate", do not dump everything. Just say: "Hello! 👋 I have the Whatomate records open. How can I help you with them today?"
3. YOU HAVE FULL ACCESS to all the data in the JSON. The JSON contains ALL details for each record (e.g., Customer Name, Product Ordered, Status, Datetime, etc.). 
4. When the user asks ANY question about the records (e.g., "What products did Praveen order?", "List all customers", "What is the status?"), YOU MUST ANSWER IT accurately by reading the JSON. Never say you don't have access to something if it exists in the JSON data! Be as helpful as possible.
5. If the user ends the conversation (says "thank you", "ok", or "bye"), give a warm farewell.`;

        await pool.query(`
            UPDATE ai_contexts 
            SET static_content = $1
            WHERE name = 'Frappe Whatomate Resource'
        `, [newStaticContent]);
        
        console.log("Successfully updated Frappe Whatomate Resource prompt to answer all JSON fields.");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}

run();
