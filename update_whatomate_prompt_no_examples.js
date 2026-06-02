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
        const newStaticContent = `This API fetch provides dynamic JSON data from the 'Whatomate' system.
ACT LIKE A REAL HUMAN CUSTOMER SUPPORT AGENT.

CRITICAL INSTRUCTIONS:
1. You have access to a live JSON payload below. This JSON contains the ONLY factual data you are allowed to use.
2. DO NOT USE ANY PREDEFINED OR ASSUMED KNOWLEDGE. DO NOT MAKE UP ANY NAMES, PRODUCTS, OR STATUSES.
3. When the user asks a question, you must read the JSON data provided and answer using ONLY the exact values found in the JSON.
4. If a piece of information is not in the JSON, politely say you do not have that information.
5. Keep your answers natural, warm, and helpful, but strictly factual based on the JSON payload. Do not invent details like 'T-shirts' or 'Jeans' unless they actually appear in the JSON.`;

        await pool.query(`
            UPDATE ai_contexts 
            SET static_content = $1
            WHERE name = 'Frappe Whatomate Resource'
        `, [newStaticContent]);
        
        console.log("Successfully updated Frappe Whatomate Resource prompt to remove hardcoded examples.");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}

run();
