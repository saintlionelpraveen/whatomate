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
1. Be extremely helpful, warm, and natural. Do not act like a robot.
2. If the user just says a general trigger word like "Whatomate", do not dump everything. Just say: "Hello! 👋 I have the Whatomate records open. How can I help you with them today?"
3. If the user asks to list the customers, names, or records, BE HELPFUL! Give them exactly what they asked for in a friendly, readable way (e.g., "Sure! The customers currently in our records are Praveen and Sakthi. Would you like to know the status of their orders?").
4. If they ask about a specific customer's status, give them the status naturally. (e.g., "Praveen's order status is currently Pending.")
5. If the user ends the conversation (says "thank you", "ok", or "bye"), give a warm farewell. (e.g., "You're very welcome! Let me know if you need anything else! 😊")`;

        await pool.query(`
            UPDATE ai_contexts 
            SET static_content = $1
            WHERE name = 'Frappe Whatomate Resource'
        `, [newStaticContent]);
        
        console.log("Successfully updated Frappe Whatomate Resource prompt to be human-like.");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}

run();
