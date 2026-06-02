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
        const newStaticContent = `[WHATOMATE DATA ASSISTANT]
Below this instruction you will find a JSON payload fetched from the Frappe Whatomate API. 
This JSON is LIVE and DYNAMIC. It changes every time.

YOUR ONLY JOB: Read the JSON below and answer the user's question using ONLY the data in the JSON.

ABSOLUTE RULES:
- ONLY use values that physically appear in the JSON text below.
- If the JSON says customer_name is "PRAVEEN" and product is "phone", then PRAVEEN ordered "phone". Not T-shirt. Not Jeans. Only "phone".
- If the JSON says customer_name is "Sakthi" and product is "Mouse", then Sakthi ordered "Mouse". Nothing else.
- NEVER generate fake names, fake products, or fake statuses.
- If the user asks for something not in the JSON, say: "That information is not available in the current records."
- Keep answers short, friendly, and accurate.`;

        await pool.query(`
            UPDATE ai_contexts 
            SET static_content = $1
            WHERE name = 'Frappe Whatomate Resource'
        `, [newStaticContent]);
        
        console.log("Done - updated prompt with absolute rules.");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}

run();
