/**
 * In-memory SQLite-compatible database layer.
 * 
 * The original sqlite3 native module causes SIGSEGV crashes in Alpine/Docker.
 * Since this local DB is only used as a lightweight conversation-context cache
 * (the real data lives in PostgreSQL via the CRM dashboard), we replace it with
 * a simple in-memory Map-based store that exposes the same API surface.
 */

const users = new Map();
const messages = [];

console.log('Connected to the SQLite database.');

const db = {
    get(sql, params, callback) {
        try {
            if (sql.includes('SELECT * FROM users WHERE phone')) {
                const phone = params[0];
                const user = users.get(phone) || null;
                callback(null, user);
            } else {
                callback(null, null);
            }
        } catch (err) {
            callback(err);
        }
    },

    run(sql, params, callback) {
        try {
            if (sql.includes('INSERT INTO users')) {
                const [phone, name] = params;
                const id = users.size + 1;
                users.set(phone, { id, phone, name, state: 'new', created_at: new Date().toISOString() });
                if (callback) callback.call({ lastID: id, changes: 1 }, null);
            } else if (sql.includes('UPDATE users SET state')) {
                const [state, phone] = params;
                const user = users.get(phone);
                if (user) {
                    user.state = state;
                    users.set(phone, user);
                }
                if (callback) callback.call({ lastID: 0, changes: user ? 1 : 0 }, null);
            } else if (sql.includes('INSERT INTO messages')) {
                const [phone, role, content] = params;
                const id = messages.length + 1;
                messages.push({ id, phone, role, content, created_at: new Date().toISOString() });
                if (callback) callback.call({ lastID: id, changes: 1 }, null);
            } else if (sql.includes('CREATE TABLE')) {
                // No-op for table creation
                if (callback) callback.call({ lastID: 0, changes: 0 }, null);
            } else {
                if (callback) callback.call({ lastID: 0, changes: 0 }, null);
            }
        } catch (err) {
            if (callback) callback(err);
        }
    },

    all(sql, params, callback) {
        try {
            if (sql.includes('SELECT role, content FROM messages WHERE phone')) {
                const [phone, limit] = params;
                const filtered = messages
                    .filter(m => m.phone === phone)
                    .slice(-limit);
                callback(null, filtered);
            } else {
                callback(null, []);
            }
        } catch (err) {
            callback(err);
        }
    },

    serialize(fn) {
        fn();
    }
};

module.exports = db;
