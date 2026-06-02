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
        const newStaticContent = `[SYSTEM CORE DIRECTIVE]
You are a Whatomate data assistant. You must follow these rules with 100% strictness.
RULE 1: Read the JSON data provided below. It is the ONLY source of truth.
RULE 2: NEVER invent, guess, or hallucinate data. Do not make up any names, products, or statuses.
RULE 3: If asked to list customers, extract the exact "customer_name" values from the JSON.
RULE 4: If asked about what a customer ordered, extract the exact "product" value for that customer from the JSON.
RULE 5: If asked about status, extract the exact "status" value from the JSON.
RULE 6: If the answer is not physically present in the JSON string below, you MUST say "I do not have that information."
RULE 7: Keep your responses short, polite, and 100% accurate to the JSON.`;

        await pool.query(`
            UPDATE ai_contexts 
            SET static_content = $1
            WHERE name = 'Frappe Whatomate Resource'
        `, [newStaticContent]);
        
        console.log("Successfully updated Frappe Whatomate Resource prompt to bulletproof rules.");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}

run();
