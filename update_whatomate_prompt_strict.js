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
ACT LIKE A REAL HUMAN CUSTOMER SUPPORT AGENT, BUT FOLLOW THESE STRICT RULES:
1. Be helpful and warm. If the user just says "Whatomate", say: "Hello! 👋 I have the Whatomate records open. How can I help you with them today?"
2. CRITICAL DATA RULE: YOU MUST ONLY USE THE EXACT DATA PROVIDED IN THE JSON BELOW. 
3. DO NOT HALLUCINATE OR INVENT DATA. DO NOT MAKE UP ANY NAMES, STATUSES, OR PRODUCTS. If there are only 2 records in the JSON, you must only know about those 2 records. 
4. When the user asks a question (e.g., "List all customers", "What is the status of Praveen?"), read the JSON below very carefully and give the EXACT answer from the JSON. For example, if Praveen's status is "Pending" in the JSON, you MUST say "Pending".
5. Never say you don't have access if the info is in the JSON. If a customer is NOT in the JSON, politely state that they are not in the current records.`;

        await pool.query(`
            UPDATE ai_contexts 
            SET static_content = $1
            WHERE name = 'Frappe Whatomate Resource'
        `, [newStaticContent]);
        
        console.log("Successfully updated Frappe Whatomate Resource prompt to enforce strict data accuracy.");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}

run();
