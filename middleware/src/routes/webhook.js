const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// GET handle verification challenge from Meta
router.get('/', webhookController.verifyWebhook);

// POST handle incoming messages from WhatsApp
router.post('/', webhookController.processMessage);

module.exports = router;
