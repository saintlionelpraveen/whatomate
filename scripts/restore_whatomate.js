const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const whatomateService = require('../src/services/whatomateService');

const dbPath = path.resolve(__dirname, '../crm.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error('Failed to open database:', err.message);
        process.exit(1);
    }
});

async function restore() {
    console.log("Starting WhatoMate data restoration...");

    // 1. Fetch all users
    const users = await new Promise((resolve, reject) => {
        db.all("SELECT * FROM users", [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    console.log(`Found ${users.length} users in local database.`);

    for (const user of users) {
        try {
            console.log(`\nRestoring user ${user.phone} (${user.name})...`);
            // Create contact in WhatoMate
            const contactId = await whatomateService.createOrFetchContact(user.phone, user.name);
            if (!contactId) {
                console.error(`Failed to get contact ID for ${user.phone}, skipping messages.`);
                continue;
            }

            // Fetch messages for this user
            const messages = await new Promise((resolve, reject) => {
                db.all("SELECT * FROM messages WHERE phone = ? ORDER BY id ASC", [user.phone], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });

            console.log(`Found ${messages.length} messages for ${user.phone}. Syncing...`);
            let successCount = 0;
            for (const msg of messages) {
                const direction = msg.role === 'bot' ? 'outbound' : 'inbound';
                try {
                    await whatomateService._postMessage(contactId, msg.content, direction);
                    successCount++;
                } catch (err) {
                    console.error(`Failed to sync message (ID: ${msg.id}):`, err.message);
                }
            }
            console.log(`Successfully synced ${successCount}/${messages.length} messages for ${user.phone}.`);
            
        } catch (error) {
            console.error(`Error restoring user ${user.phone}:`, error.message);
        }
    }

    console.log("\nRestoration complete!");
    db.close();
}

restore().catch(console.error);
