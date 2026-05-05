import OpenAI from 'npm:openai';

const QUESTION_RULES = {
  question_1_1: {
    field: 'Business Differentiators',
    hardMin: 100,
    idealMin: 200,
    idealMax: 1200,
    hardMax: 1400,
    hardMinMessage: 'Please provide a detailed description with at least 100 characters.',
    hardMaxMessage: 'This answer is too long. Please shorten it.',
    softWarningMessage: 'This answer is valid but short. For the best website copy, we recommend adding 2-3 specific examples of why clients choose you.',
    weakContentGuidance: 'specific differentiators, proof points, client benefits, or examples of why clients choose the company',
    successMessage: 'Good detail. This answer is strong enough to use.'
  },
  question_2_1: {
    field: 'Team Overview Introduction',
    hardMin: 50,
    idealMin: 150,
    idealMax: 1200,
    hardMax: 2400,
    hardMinMessage: "This introduction is too short. Please add at least one full sentence about your team's experience or focus.",
    hardMaxMessage: 'This answer is too long. Please shorten it.',
    softWarningMessage: "This answer will work, but it's a bit brief. A great team intro usually highlights experience levels, certifications, culture, or the team's client-service approach.",
    weakContentGuidance: 'team experience, certifications, specialties, company culture, service values, or what clients can expect from the team',
    successMessage: 'Good detail. This team introduction is usable.'
  },
  question_6: {
    field: 'Company Description',
    hardMin: 30,
    idealMin: 50,
    idealMax: 150,
    hardMax: 350,
    hardMinMessage: 'Too short. Please write at least one full sentence.',
    hardMaxMessage: 'This answer is too long. Please shorten it.',
    softWarningMessage: 'This is a bit long for a short company summary. Verify it is not turning into a full paragraph.',
    weakContentGuidance: 'what the company does, who it helps, where it serves clients, or what kind of IT support it provides',
    successMessage: 'This summary is clear enough to use.'
  },
  question_9: {
    field: 'Local Differentiators',
    hardMin: 100,
    idealMin: 200,
    idealMax: 1200,
    hardMax: 1400,
    hardMinMessage: 'Please provide more detail. A solid description of your local differentiators requires at least 100 characters.',
    hardMaxMessage: 'This answer is too long. Please shorten it.',
    softWarningMessage: 'Your answer is valid but a bit short. Detailed differentiators help us write better website copy. Aim for 200+ characters if possible.',
    weakContentGuidance: 'specific local advantages, local relationships, response times, regional expertise, community involvement, or ways the company is different from nearby competitors',
    successMessage: 'This differentiator description is strong enough to use.'
  },
  question_13: {
    field: 'Sales Process',
    hardMin: 50,
    idealMin: 100,
    idealMax: 1200,
    hardMax: 1400,
    hardMinMessage: 'Too short. Please describe your sales workflow.',
    hardMaxMessage: 'This answer is too long. Please shorten it.',
    softWarningMessage: 'Consider adding more detail about your process steps.',
    weakContentGuidance: 'the steps prospects go through, such as consultation, assessment, proposal, onboarding, kickoff, documentation, or follow-up',
    successMessage: 'This process description is usable.'
  },
  question_19: {
    field: 'Client Frustrations',
    hardMin: 30,
    idealMin: 51,
    idealMax: 300,
    hardMax: 500,
    hardMinMessage: 'Too short. Please identify at least one specific frustration.',
    hardMaxMessage: 'This answer is too long. Please shorten it.',
    softWarningMessage: 'This is valid but brief. Adding context about why clients are frustrated helps us write better copy.',
    weakContentGuidance: 'specific client pain points, why those problems matter, urgency, business impact, or examples such as slow response times, recurring downtime, poor security visibility, or unclear IT costs',
    successMessage: 'This answer gives enough frustration detail to use.'
  },
  question_21: {
    field: 'Value Description',
    hardMin: 30,
    idealMin: 75,
    idealMax: 1200,
    hardMax: 1400,
    hardMinMessage: 'Too short. Please describe the value you provide.',
    hardMaxMessage: 'This answer is too long. Please shorten it.',
    softWarningMessage: 'Consider adding more detail about how you deliver value.',
    weakContentGuidance: 'specific outcomes, business benefits, service approach, measurable improvements, reduced risk, productivity gains, or client experience improvements',
    successMessage: 'This value description is usable.'
  },
  question_22: {
    field: 'Ideal Client Description',
    hardMin: 30,
    idealMin: 75,
    idealMax: 150,
    hardMax: 350,
    hardMinMessage: 'Too short. Please describe your ideal client in a full sentence.',
    hardMaxMessage: 'This answer is too long. Please shorten it.',
    softWarningMessage: 'This is getting long. Ensure you are defining the avatar, not listing every requirement.',
    weakContentGuidance: 'company size, industries, operational needs, technology challenges, growth stage, compliance needs, or the kind of client relationship that fits best',
    successMessage: 'This client description is clear enough to use.'
  },
  question_23_1: {
    field: 'Industries or Client Types to Avoid',
    hardMin: 3,
    idealMin: 16,
    idealMax: 300,
    hardMax: 1400,
    hardMinMessage: 'Too short. Please specify at least one industry or client type.',
    hardMaxMessage: 'This answer is too long. Please shorten it.',
    softWarningMessage: "This is valid but very brief. Consider being more specific, such as 'Residential clients' instead of just 'Home users'.",
    weakContentGuidance: 'specific industries, client types, service situations, budget expectations, residential/commercial boundaries, or client fit criteria',
    successMessage: 'This answer is specific enough to use.'
  },
  question_25_1: {
    field: 'Additional Content Instructions',
    hardMin: 10,
    idealMin: 31,
    idealMax: 150,
    hardMax: 300,
    hardMinMessage: 'Too short. Please provide clear instructions or details.',
    hardMaxMessage: 'This answer is too long. Please shorten it.',
    softWarningMessage: 'This is valid but brief. Please ensure you are being specific enough for our writers.',
    weakContentGuidance: 'specific writing instructions, messaging preferences, content priorities, topics to include, topics to avoid, or tone guidance',
    successMessage: 'These instructions are clear enough to use.'
  }
};

const MISLEADING_LENGTH_PHRASES = [
  'too short',
  'provide at least',
  'minimum',
  'character requirement',
  'not enough characters',
  'short of needed amount'
];

function sanitizeText(text) {
  return String(text || '')
    .trim()
    .replace(/[ \t]{5,}/g, ' ')
    .replace(/([!?.,:;\-])\1{4,}/g, '$1');
}

function getCharCount(text) {
  return text.length;
}

function hasRepeatedCharacterSpam(text) {
  return /(.)\1{4,}/i.test(text);
}

function hasRepeatedWordSpam(text) {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;

  for (let i = 0; i <= words.length - 4; i += 1) {
    if (words[i] && words[i] === words[i + 1] && words[i] === words[i + 2] && words[i] === words[i + 3]) {
      return true;
    }
  }

  for (let size = 2; size <= 6; size += 1) {
    for (let i = 0; i <= words.length - size * 3; i += 1) {
      const phrase = words.slice(i, i + size).join(' ');
      if (!phrase) continue;
      const second = words.slice(i + size, i + size * 2).join(' ');
      const third = words.slice(i + size * 2, i + size * 3).join(' ');
      if (phrase === second && phrase === third) {
        return true;
      }
    }
  }

  return false;
}

function hasKeyboardSmash(text) {
  const lower = text.toLowerCase();
  const known = ['asdfjkl', 'qweqwe', 'zxczxc', 'asdfasdf', 'qwertyui', 'zxcvzxcv'];
  if (known.some((token) => lower.includes(token))) return true;

  const tokens = lower.split(/\s+/).filter(Boolean);
  return tokens.some((token) => {
    const clean = token.replace(/[^a-z0-9]/g, '');
    if (clean.length < 6) return false;
    const vowelCount = (clean.match(/[aeiou]/g) || []).length;
    const alphaCount = (clean.match(/[a-z]/g) || []).length;
    const digitCount = (clean.match(/[0-9]/g) || []).length;
    if (/[a-z]{6,}[0-9]{2,}/.test(clean)) return true;
    if (alphaCount >= 6 && vowelCount <= 1) return true;
    if (digitCount >= 3 && alphaCount >= 3) return true;
    return false;
  });
}

function hasLazyList(text) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  return lines.every((line) => line.split(/\s+/).filter(Boolean).length <= 4);
}

function hasBulletPointSymbols(text) {
  return /^\s*[-*•]/m.test(text);
}

function getExpectedRangeText(rule, count, reason) {
  if (reason === 'hardMin') {
    return `Minimum required: ${rule.hardMin} characters`;
  }
  if (reason === 'hardMax') {
    return `Maximum allowed: ${rule.hardMax} characters`;
  }
  if (reason === 'ideal' && (count < rule.idealMin || count > rule.idealMax)) {
    return `Ideal range: ${rule.idealMin}-${rule.idealMax} characters`;
  }
  return null;
}

function normalizeQuestionContext(questionContext) {
  if (questionContext && /^question_/i.test(String(questionContext))) {
    return String(questionContext);
  }

  const match = String(questionContext || '').match(/Question\s+([0-9]+(?:\.[0-9]+)?)/i);
  if (!match?.[1]) return '';
  return `question_${match[1].replace(/\./g, '_')}`;
}

function getWeakContentMessage(rule) {
  return `Content is not strong enough. Add more specific details about ${rule.weakContentGuidance}.`;
}

function shouldBlockForSpam(text, questionContext) {
  if (hasRepeatedCharacterSpam(text)) return true;
  if (hasRepeatedWordSpam(text)) return true;
  if (hasKeyboardSmash(text)) return true;
  if (questionContext === 'question_19' && hasLazyList(text)) return true;
  if ((questionContext === 'question_6' || questionContext === 'question_22') && hasBulletPointSymbols(text)) return true;
  return false;
}

function buildFallbackResponse(rule, count) {
  if (count < rule.idealMin || count > rule.idealMax) {
    return {
      status: 'needs_work',
      message: rule.softWarningMessage,
      characterCount: count,
      expectedRange: getExpectedRangeText(rule, count, 'ideal')
    };
  }

  return {
    status: 'needs_work',
    message: 'Unable to complete the AI quality check right now. Please review that your answer is specific and includes enough client-relevant detail.',
    characterCount: count,
    expectedRange: null
  };
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const rawText = body.text ?? body.user_answer ?? body.answer ?? '';
    const questionContext = normalizeQuestionContext(body.questionContext ?? body.question_context ?? body.context ?? '');

    if (!rawText || !questionContext) {
      return Response.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const rule = QUESTION_RULES[questionContext];
    if (!rule) {
      return Response.json({ error: 'Unknown question context' }, { status: 400 });
    }

    const sanitizedText = sanitizeText(rawText);
    const count = getCharCount(sanitizedText);

    if (shouldBlockForSpam(sanitizedText, questionContext)) {
      return Response.json({
        status: 'incomplete',
        message: 'Please enter a valid, specific answer without repetition or placeholder text.',
        characterCount: count,
        expectedRange: null
      });
    }

    if (count < rule.hardMin) {
      return Response.json({
        status: 'incomplete',
        message: `${rule.hardMinMessage} Minimum required: ${rule.hardMin} characters. Current count: ${count}.`,
        characterCount: count,
        expectedRange: getExpectedRangeText(rule, count, 'hardMin')
      });
    }

    if (count > rule.hardMax) {
      return Response.json({
        status: 'incomplete',
        message: `${rule.hardMaxMessage || 'This answer is too long. Please shorten it.'} Maximum allowed: ${rule.hardMax} characters. Current count: ${count}.`,
        characterCount: count,
        expectedRange: getExpectedRangeText(rule, count, 'hardMax')
      });
    }

    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_KEY') });

    const prompt = `You are validating one questionnaire answer for the field "${rule.field}".
The answer has ALREADY passed the hard character minimum and maximum checks.
Do not say the answer is too short.
Do not mention minimum characters.
Do not mention character requirements.
If the content is weak, generic, repetitive, placeholder-like, or does not answer the question strongly enough, return status \"incomplete\" with a message beginning exactly with \"Content is not strong enough.\"
After that sentence, recommend what the user should add based on the question and their current input.
If the content is acceptable but not ideal, return \"needs_work\".
If it is strong and specific, return \"complete\".
Return only JSON.

Field guidance:
- Strong answers usually include ${rule.weakContentGuidance}.
- Ideal range is ${rule.idealMin}-${rule.idealMax} characters, but this is only a quality hint, not a hard rule.

User answer:
"""
${sanitizedText}
"""

Return this exact schema:
{
  "validation_status": "complete" | "needs_work" | "incomplete",
  "user_message": "Brief user-facing feedback.",
  "quality_reason": "internal concise reason"
}`;

    let aiResult;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 180,
        response_format: { type: 'json_object' }
      });

      aiResult = JSON.parse(response.choices[0].message.content || '{}');
    } catch {
      return Response.json(buildFallbackResponse(rule, count));
    }

    const status = ['complete', 'needs_work', 'incomplete'].includes(aiResult.validation_status)
      ? aiResult.validation_status
      : 'needs_work';

    let message = String(aiResult.user_message || '').trim();
    const lowerMessage = message.toLowerCase();
    const hasMisleadingLengthPhrase = MISLEADING_LENGTH_PHRASES.some((phrase) => lowerMessage.includes(phrase));

    if (status === 'incomplete') {
      if (!message.startsWith('Content is not strong enough.') || hasMisleadingLengthPhrase) {
        message = getWeakContentMessage(rule);
      } else if (!message.toLowerCase().includes(rule.weakContentGuidance.toLowerCase().slice(0, 20))) {
        message = getWeakContentMessage(rule);
      }
    }

    if (!message) {
      if (status === 'complete') {
        message = rule.successMessage;
      } else if (status === 'needs_work') {
        message = rule.softWarningMessage;
      } else {
        message = getWeakContentMessage(rule);
      }
    }

    const expectedRange = (count < rule.idealMin || count > rule.idealMax)
      ? getExpectedRangeText(rule, count, 'ideal')
      : null;

    return Response.json({
      status,
      message,
      characterCount: count,
      expectedRange: status === 'incomplete' && message.startsWith('Content is not strong enough.') ? null : expectedRange
    });
  } catch (error) {
    console.error('Validation error:', error);
    return Response.json({ error: error.message || 'Validation failed' }, { status: 500 });
  }
});

/*
Test cases:
A. Q2.1 generic 146 chars repeated question text -> incomplete, starts with "Content is not strong enough.", no "too short", expectedRange null or ideal only.
B. Q2.1 40 chars -> incomplete, hard minimum 50 in message.
C. Q2.1 strong 180 chars -> complete or needs_work, no hard length error.
D. Q1.1 120 chars generic/repetitive -> incomplete, starts with "Content is not strong enough."
E. Q19 lazy list -> needs_work or incomplete asking for elaboration.
F. Above max -> deterministic too long message without calling AI.
*/