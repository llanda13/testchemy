import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================
// INPUT VALIDATION UTILITIES
// ============================================

// UUID v4 regex pattern
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Validation limits
const MAX_QUESTION_TEXT_LENGTH = 5000;
const MIN_THRESHOLD = 0;
const MAX_THRESHOLD = 1;
const DEFAULT_THRESHOLD = 0.7;
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
 * Validate the similarity request
 */
function validateSimilarityRequest(body: unknown): {
  valid: boolean;
  error?: string;
  data?: { questionText: string; questionId?: string; threshold: number };
} {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body: expected an object' };
  }

  const { questionText, questionId, threshold } = body as Record<string, unknown>;

  // Validate questionText (required)
  if (!questionText || typeof questionText !== 'string') {
    return { valid: false, error: 'Missing or invalid questionText: must be a non-empty string' };
  }
  if (questionText.trim().length < 3) {
    return { valid: false, error: 'questionText is too short: minimum 3 characters' };
  }
  if (questionText.length > MAX_QUESTION_TEXT_LENGTH) {
    return { valid: false, error: `questionText exceeds maximum length of ${MAX_QUESTION_TEXT_LENGTH} characters` };
  }

  // Validate questionId (optional)
  let validatedQuestionId: string | undefined;
  if (questionId !== undefined && questionId !== null && questionId !== '') {
    if (typeof questionId !== 'string') {
      return { valid: false, error: 'Invalid questionId: must be a string if provided' };
    }
    if (!isValidUUID(questionId)) {
      return { valid: false, error: 'Invalid questionId: must be a valid UUID' };
    }
    validatedQuestionId = questionId;
  }

  // Validate threshold (optional, defaults to 0.7)
  let validatedThreshold = DEFAULT_THRESHOLD;
  if (threshold !== undefined) {
    if (typeof threshold !== 'number' || isNaN(threshold)) {
      return { valid: false, error: 'Invalid threshold: must be a number' };
    }
    if (threshold < MIN_THRESHOLD || threshold > MAX_THRESHOLD) {
      return { valid: false, error: `Invalid threshold: must be between ${MIN_THRESHOLD} and ${MAX_THRESHOLD}` };
    }
    validatedThreshold = threshold;
  }

  return {
    valid: true,
    data: {
      questionText: sanitizeString(questionText, MAX_QUESTION_TEXT_LENGTH),
      questionId: validatedQuestionId,
      threshold: validatedThreshold
    }
  };
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

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
    const validation = validateSimilarityRequest(body);
    if (!validation.valid || !validation.data) {
      console.error('Validation error:', validation.error);
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { questionText, questionId, threshold } = validation.data;

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get all questions for comparison
    const { data: questions, error } = await supabaseClient
      .from('questions')
      .select('id, question_text, topic, bloom_level, knowledge_dimension')
      .neq('id', questionId || '');

    if (error) throw error;

    const similarities: Array<{
      questionId: string;
      similarity: number;
      question: Record<string, unknown>;
    }> = [];

    // Calculate similarity for each question
    for (const q of questions || []) {
      const similarity = calculateCosineSimilarity(questionText, q.question_text);
      
      if (similarity >= threshold) {
        similarities.push({
          questionId: q.id,
          similarity,
          question: q
        });

        // Store similarity score
        if (questionId) {
          await supabaseClient
            .from('question_similarities')
            .upsert({
              question1_id: questionId,
              question2_id: q.id,
              similarity_score: similarity,
              algorithm_used: 'cosine'
            });
        }
      }
    }

    // Sort by similarity descending
    similarities.sort((a, b) => b.similarity - a.similarity);

    return new Response(
      JSON.stringify({
        similarities: similarities.slice(0, 10), // Return top 10
        total: similarities.length,
        threshold
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in semantic-similarity:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============================================
// UTILITY FUNCTIONS
// ============================================

function calculateCosineSimilarity(text1: string, text2: string): number {
  const tokens1 = tokenize(text1);
  const tokens2 = tokenize(text2);
  
  const allTokens = new Set([...tokens1, ...tokens2]);
  const vector1: number[] = [];
  const vector2: number[] = [];
  
  allTokens.forEach(token => {
    vector1.push(tokens1.filter(t => t === token).length);
    vector2.push(tokens2.filter(t => t === token).length);
  });
  
  const dotProduct = vector1.reduce((sum, val, i) => sum + val * vector2[i], 0);
  const magnitude1 = Math.sqrt(vector1.reduce((sum, val) => sum + val * val, 0));
  const magnitude2 = Math.sqrt(vector2.reduce((sum, val) => sum + val * val, 0));
  
  if (magnitude1 === 0 || magnitude2 === 0) return 0;
  return dotProduct / (magnitude1 * magnitude2);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2);
}
