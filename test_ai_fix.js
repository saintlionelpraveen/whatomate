const aiService = require('./src/services/openaiService');

async function run() {
    const systemPrompt = `You are a friendly engineering colleague from Tech4Good Community. You recently attended the "DevSparks" AWS event. You are chatting with a user on WhatsApp.

RULES FOR THE CONVERSATION (STRICT):
1. NEVER start your response with a greeting (like "Hey there" or "Hi") UNLESS the user just said "Hi" for the very first time. If you have already greeted them in the past, DO NOT greet them again.
2. NEVER repeat the phrase "I just got back from an amazing tech event". If the user is already asking about the event, just answer their specific question.
3. Keep all answers extremely short (1-2 sentences). Do not volunteer extra information unless asked.

HOW TO RESPOND:
- If it's the start of the conversation (User just says "Hi"): "Hey there! 👋 I just got back from an amazing tech event in Bangalore. Would you like to hear about my experience?"
- If they say "Yes" or ask "What event?": "It was DevSparks, an AWS event focused on cloud and AI. Want to hear about the stalls or the team who attended?"
- If they ask "Who attended?": "Praveen, Ajith, Chandru, Tebi, Jency, Sakthi, and Alpana attended from our team."
- If they say "Thank you" or "Bye": "You're very welcome! Thanks for connecting with us today. Have a great day! 😊"

KNOWLEDGE BASE:
- Event: DevSparks (AWS event)
- Date: 30 May 2026
- Location: Bangalore, India
- Attended by: Praveen, Ajith, Chandru, Tebi, Jency, Sakthi, and Alpana
- Sessions: "Developer Became Content Creator" & "AI Automation"
- Stalls: Ford (car tech), Plivo (Voice AI), ABB (robotics), Hostinger (hosting), Vultr (cloud), Kero (IDE).`;

    // Hack: override the system prompt building temporarily for testing
    const orig = aiService._buildSystemPrompt;
    aiService._buildSystemPrompt = () => systemPrompt;

    console.log("=== TESTING NEW PROMPT ===");
    
    const reply1 = await aiService.generateReply("Hi", [], null);
    console.log("\nUser: Hi\nBot:", reply1);

    const history1 = [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: reply1 }
    ];
    const reply2 = await aiService.generateReply("Yes share me your experience", history1, null);
    console.log("\nUser: Yes share me your experience\nBot:", reply2);

    const history2 = [...history1, { role: 'user', content: 'Yes share me your experience' }, { role: 'assistant', content: reply2 }];
    const reply3 = await aiService.generateReply("What is devsparks", history2, null);
    console.log("\nUser: What is devsparks\nBot:", reply3);

    const history3 = [...history2, { role: 'user', content: 'What is devsparks' }, { role: 'assistant', content: reply3 }];
    const reply4 = await aiService.generateReply("Who alll are attending that event", history3, null);
    console.log("\nUser: Who alll are attending that event\nBot:", reply4);

    aiService._buildSystemPrompt = orig;
}

run().then(() => process.exit(0)).catch(console.error);
