const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5433', 10),
    user: process.env.POSTGRES_USER || 'whatomate',
    password: process.env.POSTGRES_PASSWORD || 'whatomate',
    database: process.env.POSTGRES_DB || 'whatomate',
});

async function main() {
    const res = await pool.query('SELECT id, name, static_content FROM ai_contexts');
    console.log(JSON.stringify(res.rows, null, 2));
    process.exit(0);
}
main().catch(console.error);
