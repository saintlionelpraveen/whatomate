const aiService = require('./src/services/openaiService');

async function run() {
    const history = [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hey there! I just got back from the DevSparks event in Bangalore.' },
        { role: 'user', content: 'Tell me about the Ford stall' }
    ];
    const reply = await aiService.generateReply("Tell me about the Ford stall", history, null);
    console.log("Reply with history:", reply);
}

run().then(() => process.exit(0)).catch(console.error);
