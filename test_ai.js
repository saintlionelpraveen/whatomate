const aiService = require('./src/services/openaiService');

async function run() {
    const reply1 = await aiService.generateReply("Tell me about the experience that you get from the event", [], null);
    console.log("Reply 1:", reply1);

    const reply2 = await aiService.generateReply("Tell me about the event", [], null);
    console.log("Reply 2:", reply2);

    const reply3 = await aiService.generateReply("What do s devsparks", [], null);
    console.log("Reply 3:", reply3);
}

run().then(() => process.exit(0)).catch(console.error);
