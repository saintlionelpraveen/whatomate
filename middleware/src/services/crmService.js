const db = require('../config/db');

class CRMService {
    getUser(phone) {
        return new Promise((resolve, reject) => {
            db.get(`SELECT * FROM users WHERE phone = ?`, [phone], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });
    }

    createUser(phone, name) {
        return new Promise((resolve, reject) => {
            db.run(`INSERT INTO users (phone, name) VALUES (?, ?)`, [phone, name], function (err) {
                if (err) reject(err);
                resolve(this.lastID);
            });
        });
    }

    updateUserState(phone, state) {
        return new Promise((resolve, reject) => {
            db.run(`UPDATE users SET state = ? WHERE phone = ?`, [state, phone], function (err) {
                if (err) reject(err);
                resolve(this.changes);
            });
        });
    }

    saveMessage(phone, role, content) {
        return new Promise((resolve, reject) => {
            db.run(`INSERT INTO messages (phone, role, content) VALUES (?, ?, ?)`, [phone, role, content], function (err) {
                if (err) reject(err);
                resolve(this.lastID);
            });
        });
    }

    getRecentMessages(phone, limit = 10) {
        return new Promise((resolve, reject) => {
            db.all(`SELECT role, content FROM messages WHERE phone = ? ORDER BY created_at DESC LIMIT ?`, [phone, limit], (err, rows) => {
                if (err) reject(err);
                resolve((rows || []).reverse());
            });
        });
    }
}

module.exports = new CRMService();
