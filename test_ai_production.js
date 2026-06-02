const aiService = require('./src/services/openaiService');

async function run() {
    console.log("=== TESTING PRODUCTION FLOW ===");
    
    // Test 1: Initial Greeting
    const reply1 = await aiService.generateReply("Hi", [], null);
    console.log("\nUser: Hi\nBot:", reply1);

    // Test 2: Showing Interest
    const history1 = [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: reply1 },
        { role: 'user', content: 'Tell me about the experience that you get from the event' }
    ];
    const reply2 = await aiService.generateReply("Tell me about the experience that you get from the event", history1, null);
    console.log("\nUser: Tell me about the experience that you get from the event\nBot:", reply2);

    // Test 3: Specific Question (Attendees)
    const history2 = [...history1, { role: 'assistant', content: reply2 }, { role: 'user', content: 'Ok tell me who all are attending that event' }];
    const reply3 = await aiService.generateReply("Ok tell me who all are attending that event", history2, null);
    console.log("\nUser: Ok tell me who all are attending that event\nBot:", reply3);

    // Test 4: Closing
    const history3 = [...history2, { role: 'assistant', content: reply3 }, { role: 'user', content: 'Ok thank you' }];
    const reply4 = await aiService.generateReply("Ok thank you", history3, null);
    console.log("\nUser: Ok thank you\nBot:", reply4);
}

run().then(() => process.exit(0)).catch(console.error);
