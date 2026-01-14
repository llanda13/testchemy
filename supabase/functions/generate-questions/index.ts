import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================
// INPUT VALIDATION UTILITIES
// ============================================

// Valid enum values for strict validation
const VALID_BLOOM_LEVELS = ['Remembering', 'Understanding', 'Applying', 'Analyzing', 'Evaluating', 'Creating'];
const VALID_DIFFICULTIES = ['Easy', 'Average', 'Difficult'];

// UUID v4 regex pattern
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Validation limits
const MAX_TOPIC_LENGTH = 500;
const MAX_COUNT = 20;
const MIN_COUNT = 1;
const MAX_REQUEST_SIZE = 50000; // 50KB max request size

/**
 * Validate UUID format
 */
function isValidUUID(value: string): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/**
 * Sanitize string input - remove potentially dangerous characters
 */
function sanitizeString(input: string, maxLength: number): string {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .slice(0, maxLength)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, ''); // Remove event handlers
}

/**
 * Validate and sanitize the generation request
 */
function validateGenerationRequest(body: unknown): { 
  valid: boolean; 
  error?: string; 
  data?: { tos_id: string; request: { topic: string; bloom_level: string; difficulty: string; count: number } } 
} {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body: expected an object' };
  }

  const { tos_id, request } = body as Record<string, unknown>;

  // Validate tos_id
  if (!tos_id || typeof tos_id !== 'string') {
    return { valid: false, error: 'Missing or invalid tos_id: must be a string' };
  }
  if (!isValidUUID(tos_id)) {
    return { valid: false, error: 'Invalid tos_id: must be a valid UUID' };
  }

  // Validate request object
  if (!request || typeof request !== 'object') {
    return { valid: false, error: 'Missing or invalid request: must be an object' };
  }

  const { topic, bloom_level, difficulty, count } = request as Record<string, unknown>;

  // Validate topic
  if (!topic || typeof topic !== 'string') {
    return { valid: false, error: 'Missing or invalid topic: must be a string' };
  }
  if (topic.trim().length < 2) {
    return { valid: false, error: 'Topic is too short: minimum 2 characters' };
  }
  if (topic.length > MAX_TOPIC_LENGTH) {
    return { valid: false, error: `Topic is too long: maximum ${MAX_TOPIC_LENGTH} characters` };
  }

  // Validate bloom_level against allowed enum values
  if (!bloom_level || typeof bloom_level !== 'string') {
    return { valid: false, error: 'Missing or invalid bloom_level: must be a string' };
  }
  if (!VALID_BLOOM_LEVELS.includes(bloom_level)) {
    return { valid: false, error: `Invalid bloom_level: must be one of ${VALID_BLOOM_LEVELS.join(', ')}` };
  }

  // Validate difficulty against allowed enum values
  if (!difficulty || typeof difficulty !== 'string') {
    return { valid: false, error: 'Missing or invalid difficulty: must be a string' };
  }
  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    return { valid: false, error: `Invalid difficulty: must be one of ${VALID_DIFFICULTIES.join(', ')}` };
  }

  // Validate count
  const parsedCount = typeof count === 'number' ? count : (count === undefined ? 5 : parseInt(String(count), 10));
  if (isNaN(parsedCount) || parsedCount < MIN_COUNT || parsedCount > MAX_COUNT) {
    return { valid: false, error: `Invalid count: must be a number between ${MIN_COUNT} and ${MAX_COUNT}` };
  }

  return {
    valid: true,
    data: {
      tos_id: tos_id,
      request: {
        topic: sanitizeString(topic, MAX_TOPIC_LENGTH),
        bloom_level: bloom_level,
        difficulty: difficulty,
        count: parsedCount
      }
    }
  };
}

// ============================================
// BLOOM TAXONOMY CONFIGURATION
// ============================================

/**
 * HIGHER ORDER BLOOM LEVELS - These FORBID generic listing
 */
const HIGHER_ORDER_BLOOMS = ['Analyzing', 'Evaluating', 'Creating'];

/**
 * FIX #4: Forbidden patterns for higher-order Bloom levels
 */
const FORBIDDEN_LISTING_PATTERNS = [
  /\b(include|includes)\b/i,
  /\bsuch as\b/i,
  /\bfactors\s+(are|include)\b/i,
  /\bkey\s+(factors|elements|components)\s+(are|include)\b/i,
];

/**
 * Get default answer type based on Bloom level
 */
function getDefaultAnswerType(bloomLevel: string): string {
  const defaults: Record<string, string> = {
    'Remembering': 'definition',
    'Understanding': 'explanation',
    'Applying': 'application',
    'Analyzing': 'analysis',
    'Evaluating': 'evaluation',
    'Creating': 'design',
  };
  return defaults[bloomLevel] || 'explanation';
}

/**
 * FIX #4: Check if answer violates structural constraints
 */
function shouldRejectAnswer(answerType: string, answer: string, bloomLevel: string): boolean {
  if (answerType === 'definition') return false;
  
  const isHigherOrder = HIGHER_ORDER_BLOOMS.includes(bloomLevel);
  if (isHigherOrder) {
    for (const pattern of FORBIDDEN_LISTING_PATTERNS) {
      if (pattern.test(answer)) return true;
    }
  }
  return false;
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let generationSuccess = true;
  let errorType = '';

  try {
    // Check request size
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_SIZE) {
      return new Response(
        JSON.stringify({ error: `Request too large: maximum ${MAX_REQUEST_SIZE} bytes` }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    let body: unknown;
    try {
      body = await req.json();
    } catch (parseError) {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate and sanitize input
    const validation = validateGenerationRequest(body);
    if (!validation.valid || !validation.data) {
      console.error('Validation error:', validation.error);
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { tos_id, request: validatedRequest } = validation.data;
    const { topic, bloom_level, difficulty, count } = validatedRequest;

    console.log('Generating questions for:', { tos_id, topic, bloom_level, difficulty, count });

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get OpenAI API key
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      console.error('OpenAI API key not configured');
      return new Response(
        JSON.stringify({ error: 'Service temporarily unavailable' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // FIX #1 & #2: Bloom instructions now forbid generic listing for higher levels
    const bloomInstructions: Record<string, string> = {
      'Remembering': 'Focus on recall, recognition, and basic facts. Use verbs like define, list, identify, state. Answer type: definition.',
      'Understanding': 'Focus on comprehension and explanation. Use verbs like explain, summarize, describe, interpret. Answer type: explanation.',
      'Applying': 'Focus on using knowledge in new situations. Use verbs like apply, use, implement, solve. Answer type: application.',
      'Analyzing': 'Focus on breaking down information and relationships. Use verbs like analyze, compare, differentiate, examine. Answer type: analysis. FORBIDDEN: generic listing, "include", "such as".',
      'Evaluating': 'Focus on making judgments with justification. Use verbs like evaluate, justify, critique, assess. Answer type: evaluation. FORBIDDEN: generic listing, "include", "such as". MUST include a verdict.',
      'Creating': 'Focus on producing new work. Use verbs like design, create, compose, formulate. Answer type: design. FORBIDDEN: generic listing. MUST produce tangible output.'
    };

    const difficultyInstructions = {
      'Easy': 'Simple, straightforward questions with obvious answers.',
      'Average': 'Moderate complexity requiring some thought and understanding.',
      'Difficult': 'Complex questions requiring deep analysis and critical thinking.'
    };

    const prompt = `Generate ${count} multiple-choice questions for the topic "${topic}" at Bloom's taxonomy level "${bloom_level}" with "${difficulty}" difficulty.

Bloom's Level Instructions: ${bloomInstructions[bloom_level as keyof typeof bloomInstructions] || bloomInstructions['Understanding']}

Difficulty Instructions: ${difficultyInstructions[difficulty as keyof typeof difficultyInstructions] || difficultyInstructions['Average']}

Requirements:
1. Each question must have exactly 4 choices (A, B, C, D)
2. Only one correct answer per question
3. Distractors must be plausible but clearly incorrect
4. No "All of the above" or "None of the above" options
5. Choices should be similar in length and grammatical structure
6. Questions should align with the specified Bloom's level and difficulty

Return a JSON object with an "items" array containing questions in this exact format:
{
  "items": [
    {
      "text": "Question text here?",
      "choices": {
        "A": "First choice",
        "B": "Second choice", 
        "C": "Third choice",
        "D": "Fourth choice"
      },
      "correct_answer": "A",
      "bloom_level": "${bloom_level}",
      "difficulty": "${difficulty}",
      "knowledge_dimension": "Conceptual"
    }
  ]
}`;

    console.log('Sending prompt to OpenAI...');

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert educational content creator specializing in generating high-quality multiple-choice questions that align with Bloom\'s taxonomy and educational standards.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 3000
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to generate questions from AI service' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiResponse = await response.json();
    console.log('OpenAI response received');

    let generatedQuestions;
    try {
      const content = aiResponse.choices[0].message.content;
      generatedQuestions = JSON.parse(content);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      return new Response(
        JSON.stringify({ error: 'Invalid response format from AI service' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const items = generatedQuestions.items || [];
    console.log(`Generated ${items.length} questions`);

    // Validate and filter questions
    const validQuestions = items.filter((q: any) => {
      return (
        q.text && q.text.length > 10 &&
        q.choices && 
        ['A', 'B', 'C', 'D'].every(key => q.choices[key] && q.choices[key].length > 0) &&
        ['A', 'B', 'C', 'D'].includes(q.correct_answer)
      );
    });

    console.log(`${validQuestions.length} questions passed validation`);

    if (validQuestions.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid questions were generated' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get current user from auth header
    const authHeader = req.headers.get('authorization');
    let userId = null;
    
    if (authHeader) {
      try {
        const token = authHeader.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        userId = user?.id;
      } catch (authError) {
        console.error('Auth error:', authError);
      }
    }

    // Prepare questions for database insertion
    const questionsToInsert = validQuestions.map((q: any) => ({
      tos_id,
      topic,
      question_text: q.text,
      question_type: 'multiple-choice',
      choices: q.choices,
      correct_answer: q.correct_answer,
      bloom_level: q.bloom_level || bloom_level,
      difficulty: q.difficulty || difficulty,
      knowledge_dimension: q.knowledge_dimension || 'Conceptual',
      created_by: 'ai',
      approved: false,
      confidence_score: 0.8,
      owner: userId
    }));

    // Insert questions into database
    const { data: insertedQuestions, error: insertError } = await supabase
      .from('questions')
      .insert(questionsToInsert)
      .select('*');

    if (insertError) {
      console.error('Database insertion error:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save questions to database', details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Successfully inserted ${insertedQuestions?.length || 0} questions`);

    // Record metrics
    const duration = Date.now() - startTime;
    const avgQuality = validQuestions.reduce((sum: number, q: any) => sum + (q.quality_score || 0.8), 0) / validQuestions.length;

    // Record metrics (fire and forget)
    supabase.from('performance_benchmarks').insert({
      operation_name: 'generate_questions',
      min_response_time: duration,
      average_response_time: duration,
      max_response_time: duration,
      error_rate: 0,
      throughput: validQuestions.length,
      measurement_period_minutes: 1
    });

    supabase.from('quality_metrics').insert({
      entity_type: 'question_generation',
      characteristic: 'Functional Completeness',
      metric_name: 'generation_success_rate',
      value: (insertedQuestions?.length || 0) / count,
      unit: 'ratio',
      automated: true
    });

    supabase.from('system_metrics').insert({
      metric_category: 'performance',
      metric_name: 'question_generation_time',
      metric_value: duration,
      metric_unit: 'ms',
      dimensions: {
        count: validQuestions.length,
        avg_quality: avgQuality,
        bloom_level,
        difficulty
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        generated_count: validQuestions.length,
        inserted_count: insertedQuestions?.length || 0,
        questions: insertedQuestions
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    generationSuccess = false;
    errorType = error instanceof Error ? error.name : 'UnknownError';
    console.error('Unexpected error:', error);
    
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Record error metrics
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      await supabase.from('performance_benchmarks').insert({
        operation_name: 'generate_questions',
        min_response_time: duration,
        average_response_time: duration,
        max_response_time: duration,
        error_rate: 1,
        throughput: 0,
        measurement_period_minutes: 1
      });

      await supabase.from('system_metrics').insert({
        metric_category: 'reliability',
        metric_name: 'error_occurrence',
        metric_value: 1,
        dimensions: {
          error_type: errorType,
          error_message: message,
          operation: 'generate_questions'
        }
      });
    } catch (metricsError) {
      console.error('Failed to record error metrics:', metricsError);
    }

    return new Response(
      JSON.stringify({ error: 'An unexpected error occurred', details: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});