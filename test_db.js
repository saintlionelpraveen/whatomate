const crm = require('./src/services/crmService');
async function run() {
    // try to get some messages
    const msgs = await new Promise((res, rej) => {
        require('./src/config/db').all('SELECT * FROM messages ORDER BY id DESC LIMIT 5', (err, rows) => {
            if (err) rej(err); else res(rows);
        });
    });
    console.log(msgs);
}
run().then(() => process.exit(0)).catch(console.error);
