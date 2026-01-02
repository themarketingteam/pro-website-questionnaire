import OpenAI from 'npm:openai';

const VALIDATION_INSTRUCTIONS = {
  question_1_1: {
    field: "Why Choose Us Description",
    criteria: [
      "Clearly articulates unique value propositions and differentiators",
      "Includes specific, tangible benefits for clients",
      "Professional tone appropriate for B2B MSP audience",
      "Minimum 100 characters, ideal 150-300 characters"
    ]
  },
  question_2_1: {
    field: "Team Introduction",
    criteria: [
      "Professional and welcoming tone",
      "Highlights team expertise, values, or culture",
      "Creates connection with potential clients",
      "Minimum 100 characters, ideal 150-300 characters"
    ]
  },
  question_23_1: {
    field: "Avoided Client Types",
    criteria: [
      "Clearly describes client types or situations to avoid",
      "Professional and tactful phrasing",
      "Provides specific, actionable criteria",
      "Minimum 50 characters"
    ]
  },
  question_25_1: {
    field: "Additional Notes",
    criteria: [
      "Provides clear, specific content guidance",
      "Focuses on content needs, not design preferences",
      "Actionable for content creation team",
      "Minimum 30 characters"
    ]
  }
};

Deno.serve(async (req) => {
  try {
    const { text, questionContext } = await req.json();

    if (!text || !questionContext) {
      return Response.json({ 
        error: 'Missing required parameters' 
      }, { status: 400 });
    }

    const openai = new OpenAI({
      apiKey: Deno.env.get('OPENAI_KEY')
    });

    const instructions = VALIDATION_INSTRUCTIONS[questionContext];
    if (!instructions) {
      return Response.json({ 
        error: 'Unknown question context' 
      }, { status: 400 });
    }

    const prompt = `You are a form validation assistant. Validate the following answer for the "${instructions.field}" field.

Criteria:
${instructions.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

User's answer:
"${text}"

Character count: ${text.length}

Respond with ONLY a JSON object (no markdown, no extra text) in this exact format:
{
  "validation_status": "complete" | "needs_work" | "incomplete",
  "user_message": "Brief feedback message for the user (1-2 sentences max)"
}

Use "complete" if it meets all criteria well, "needs_work" if it's acceptable but could be improved, "incomplete" if it fails to meet minimum requirements.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 150
    });

    const content = response.choices[0].message.content.trim();
    
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid response format from AI');
    }

    const result = JSON.parse(jsonMatch[0]);

    return Response.json({
      status: result.validation_status,
      message: result.user_message,
      characterCount: text.length
    });

  } catch (error) {
    console.error('Validation error:', error);
    return Response.json({ 
      error: error.message || 'Validation failed' 
    }, { status: 500 });
  }
});