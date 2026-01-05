import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

// ============= TYPES =============

interface TopicDistribution {
  topic: string;
  counts: {
    remembering: number;
    understanding: number;
    applying: number;
    analyzing: number;
    evaluating: number;
    creating: number;
    difficulty: { easy: number; average: number; difficult: number };
  };
}

interface GenerationInput {
  tos_id: string;
  total_items: number;
  distributions: TopicDistribution[];
  allow_unapproved?: boolean;
  prefer_existing?: boolean;
}

/**
 * SLOT: A predefined requirement from the TOS
 * The TOS is law - slots define what MUST exist
 */
interface Slot {
  id: string;
  topic: string;
  bloomLevel: string;
  difficulty: string;
  knowledgeDimension: string;
  filled: boolean;
  question?: any;
  source?: 'bank' | 'ai';
}

/**
 * Registry for tracking used concepts/operations across entire session
 * Prevents redundancy BEFORE generation
 */
interface GenerationRegistry {
  usedConcepts: Record<string, string[]>;      // topic -> concepts used
  usedOperations: Record<string, string[]>;    // topic_bloom -> operations used
  usedPairs: string[];                          // concept::operation pairs
  usedQuestionTexts: string[];                  // for text similarity check
}

// ============= CONSTANTS =============

const BLOOM_LEVELS = ['remembering', 'understanding', 'applying', 'analyzing', 'evaluating', 'creating'];

const BLOOM_KNOWLEDGE_MAPPING: Record<string, string> = {
  'remembering': 'factual',
  'understanding': 'conceptual',
  'applying': 'procedural',
  'analyzing': 'conceptual',
  'evaluating': 'metacognitive',
  'creating': 'metacognitive'
};

const BLOOM_COGNITIVE_OPERATIONS: Record<string, string[]> = {
  'remembering': ['recall', 'recognize', 'identify', 'list', 'name', 'define', 'state'],
  'understanding': ['explain', 'summarize', 'interpret', 'classify', 'compare', 'describe', 'paraphrase'],
  'applying': ['execute', 'implement', 'solve', 'use', 'demonstrate', 'apply', 'calculate'],
  'analyzing': ['differentiate', 'organize', 'attribute', 'deconstruct', 'examine', 'contrast', 'distinguish'],
  'evaluating': ['check', 'critique', 'judge', 'prioritize', 'justify', 'assess', 'defend', 'evaluate'],
  'creating': ['generate', 'plan', 'produce', 'design', 'construct', 'formulate', 'compose', 'develop']
};

const CONCEPT_POOL = [
  'core principles', 'key components', 'fundamental concepts', 'main processes',
  'critical factors', 'essential elements', 'primary functions', 'basic mechanisms',
  'important relationships', 'significant characteristics', 'defining features', 'crucial aspects',
  'major categories', 'fundamental distinctions', 'core applications', 'primary considerations',
  'essential requirements', 'key differences', 'important limitations', 'critical constraints'
];

const ANSWER_TYPE_BY_BLOOM: Record<string, string[]> = {
  'remembering': ['definition', 'identification'],
  'understanding': ['explanation', 'comparison', 'interpretation'],
  'applying': ['application', 'procedure', 'demonstration'],
  'analyzing': ['analysis', 'differentiation', 'organization'],
  'evaluating': ['evaluation', 'justification', 'critique'],
  'creating': ['design', 'construction', 'synthesis']
};

// ============= SUPABASE CLIENT =============

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// ============= SLOT GENERATION =============

/**
 * STEP 1: Lock the TOS and expand into slots
 * The TOS is immutable - each cell becomes a slot that MUST be filled
 */
function expandTOSToSlots(distributions: TopicDistribution[]): Slot[] {
  const slots: Slot[] = [];
  let slotId = 1;

  for (const dist of distributions) {
    const topic = dist.topic;
    
    for (const bloom of BLOOM_LEVELS) {
      const count = dist.counts[bloom as keyof typeof dist.counts] as number;
      if (!count || count <= 0) continue;

      // Distribute across difficulty levels
      const { easy, average, difficult } = dist.counts.difficulty;
      const totalDiff = Math.max(1, easy + average + difficult);
      
      const easyCount = Math.round(count * (easy / totalDiff));
      const averageCount = Math.round(count * (average / totalDiff));
      const difficultCount = Math.max(0, count - easyCount - averageCount);

      const difficulties = [
        { level: 'easy', count: easyCount },
        { level: 'average', count: averageCount },
        { level: 'difficult', count: difficultCount }
      ];

      for (const { level, count: diffCount } of difficulties) {
        for (let i = 0; i < diffCount; i++) {
          // STEP 3: Assign knowledge dimension based on Bloom level
          const knowledgeDimension = BLOOM_KNOWLEDGE_MAPPING[bloom] || 'conceptual';
          
          slots.push({
            id: `slot_${slotId++}`,
            topic,
            bloomLevel: bloom,
            difficulty: level,
            knowledgeDimension,
            filled: false
          });
        }
      }
    }
  }

  console.log(`📋 Expanded TOS into ${slots.length} slots`);
  return slots;
}

// ============= BANK RETRIEVAL =============

/**
 * STEP 4: Attempt retrieval from bank before generation
 * For each slot, try to find a matching question that hasn't been used
 */
async function fillSlotsFromBank(
  slots: Slot[],
  registry: GenerationRegistry,
  allowUnapproved: boolean
): Promise<{ filled: Slot[]; unfilled: Slot[] }> {
  const filled: Slot[] = [];
  const unfilled: Slot[] = [];

  // Group slots by topic+bloom for efficient querying
  const slotGroups = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = `${slot.topic}::${slot.bloomLevel}::${slot.difficulty}`;
    if (!slotGroups.has(key)) {
      slotGroups.set(key, []);
    }
    slotGroups.get(key)!.push(slot);
  }

  for (const [key, groupSlots] of slotGroups) {
    const [topic, bloom, difficulty] = key.split('::');
    
    // Query bank for matching questions
    const normalizedBloom = bloom.charAt(0).toUpperCase() + bloom.slice(1).toLowerCase();
    const bloomVariants = Array.from(new Set([bloom, bloom.toLowerCase(), normalizedBloom]));

    let query = supabase
      .from('questions')
      .select('*')
      .eq('deleted', false)
      .eq('difficulty', difficulty)
      .ilike('topic', `%${topic}%`)
      .in('bloom_level', bloomVariants)
      .order('used_count', { ascending: true });

    if (!allowUnapproved) {
      query = query.eq('approved', true);
    }

    const { data: bankQuestions, error } = await query.limit(groupSlots.length * 3);

    if (error) {
      console.error(`Error querying bank for ${key}:`, error);
      unfilled.push(...groupSlots);
      continue;
    }

    // Select non-redundant questions for each slot
    const availableQuestions = [...(bankQuestions || [])];
    
    for (const slot of groupSlots) {
      const selectedQuestion = selectNonRedundantQuestion(
        availableQuestions,
        registry,
        slot.topic
      );

      if (selectedQuestion) {
        // Remove from available pool
        const idx = availableQuestions.findIndex(q => q.id === selectedQuestion.id);
        if (idx > -1) availableQuestions.splice(idx, 1);
        
        // Mark as used in registry
        registerQuestion(registry, slot.topic, slot.bloomLevel, selectedQuestion);
        
        slot.filled = true;
        slot.question = selectedQuestion;
        slot.source = 'bank';
        filled.push(slot);
      } else {
        unfilled.push(slot);
      }
    }
  }

  console.log(`📚 Filled ${filled.length} slots from bank, ${unfilled.length} need AI generation`);
  return { filled, unfilled };
}

/**
 * Select a question that won't create redundancy
 */
function selectNonRedundantQuestion(
  candidates: any[],
  registry: GenerationRegistry,
  topic: string
): any | null {
  for (const candidate of candidates) {
    const text = candidate.question_text?.toLowerCase() || '';
    
    // Check text similarity with already used questions
    const isSimilar = registry.usedQuestionTexts.some(usedText => {
      const similarity = calculateTextSimilarity(text, usedText);
      return similarity > 0.7;
    });

    if (!isSimilar) {
      return candidate;
    }
  }
  
  return null;
}

/**
 * Register a question as used to prevent redundancy
 */
function registerQuestion(
  registry: GenerationRegistry,
  topic: string,
  bloomLevel: string,
  question: any
): void {
  const text = question.question_text?.toLowerCase() || '';
  registry.usedQuestionTexts.push(text);
  
  // Extract and register concept if available
  const concept = question.targeted_concept || extractConcept(text);
  if (concept) {
    if (!registry.usedConcepts[topic]) {
      registry.usedConcepts[topic] = [];
    }
    registry.usedConcepts[topic].push(concept.toLowerCase());
  }
}

/**
 * Simple text similarity using word overlap
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(text2.split(/\s+/).filter(w => w.length > 3));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  let intersection = 0;
  words1.forEach(w => { if (words2.has(w)) intersection++; });
  
  return intersection / Math.min(words1.size, words2.size);
}

/**
 * Extract concept from question text (simple heuristic)
 */
function extractConcept(text: string): string | null {
  // Look for common patterns
  const patterns = [
    /(?:define|explain|describe|analyze)\s+(?:the\s+)?(?:concept\s+of\s+)?["']?([^"'.?]+)/i,
    /(?:what\s+is|what\s+are)\s+(?:the\s+)?["']?([^"'.?]+)/i,
    /(?:how\s+does|how\s+do)\s+["']?([^"'.?]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim().substring(0, 50);
    }
  }
  
  return null;
}

// ============= AI GENERATION =============

/**
 * STEP 5: AI Generation happens only when needed
 * Each unfilled slot gets a unique intent with pre-assigned concept and operation
 */
async function fillSlotsWithAI(
  slots: Slot[],
  registry: GenerationRegistry
): Promise<Slot[]> {
  if (slots.length === 0) return [];

  const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openAIApiKey) {
    console.error('OpenAI API key not configured');
    return slots.map(s => ({ ...s, filled: false }));
  }

  // Group by topic+bloom for batch generation
  const slotGroups = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = `${slot.topic}::${slot.bloomLevel}`;
    if (!slotGroups.has(key)) {
      slotGroups.set(key, []);
    }
    slotGroups.get(key)!.push(slot);
  }

  const filledSlots: Slot[] = [];

  for (const [key, groupSlots] of slotGroups) {
    const [topic, bloom] = key.split('::');

    // Retry per group to ensure we fill as many slots as possible
    let pendingSlots = [...groupSlots];
    let attempt = 0;

    while (pendingSlots.length > 0 && attempt < 3) {
      attempt++;

      // Assign unique concepts and operations for each pending slot
      const intents = pendingSlots.map(slot => {
        const concept = selectNextConcept(registry, topic);
        const operation = selectNextOperation(registry, topic, bloom);
        const answerType = selectAnswerType(bloom);

        // Mark as used immediately (so retries advance to fresh intents)
        markConceptUsed(registry, topic, concept);
        markOperationUsed(registry, topic, bloom, operation);
        markPairUsed(registry, concept, operation);

        return {
          slot,
          concept,
          operation,
          answerType,
          difficulty: slot.difficulty,
          knowledgeDimension: slot.knowledgeDimension
        };
      });

      try {
        const questions = await generateQuestionsWithIntents(
          topic,
          bloom,
          intents,
          openAIApiKey,
          registry
        );

        let filledThisAttempt = 0;

        // Match questions back to slots
        for (let i = 0; i < intents.length && i < questions.length; i++) {
          const slot = intents[i].slot;
          const question = questions[i];

          if (question) {
            registerQuestion(registry, topic, bloom, question);
            slot.filled = true;
            slot.question = question;
            slot.source = 'ai';
            filledSlots.push(slot);
            filledThisAttempt++;
          }
        }

        pendingSlots = pendingSlots.filter(s => !s.filled);

        if (pendingSlots.length > 0) {
          console.warn(`🔁 Retry ${attempt}/3: ${pendingSlots.length} slots still unfilled for ${key}`);
        }

        // If we got nothing back, further retries are unlikely to help
        if (filledThisAttempt === 0) {
          break;
        }

      } catch (error) {
        console.error(`AI generation attempt ${attempt} failed for ${key}:`, error);
      }
    }

    if (pendingSlots.length > 0) {
      console.warn(`⚠️ Could not fill ${pendingSlots.length} slots for ${key} after retries`);
    }
  }

  console.log(`🤖 AI filled ${filledSlots.length}/${slots.length} slots`);
  return filledSlots;
}

/**
 * Select next available concept for topic
 */
function selectNextConcept(registry: GenerationRegistry, topic: string): string {
  const used = registry.usedConcepts[topic] || [];
  const available = CONCEPT_POOL.filter(c => !used.includes(c.toLowerCase()));
  return available.length > 0 ? available[0] : CONCEPT_POOL[used.length % CONCEPT_POOL.length];
}

/**
 * Select next available operation for topic+bloom
 */
function selectNextOperation(registry: GenerationRegistry, topic: string, bloom: string): string {
  const key = `${topic.toLowerCase()}_${bloom.toLowerCase()}`;
  const used = registry.usedOperations[key] || [];
  const available = (BLOOM_COGNITIVE_OPERATIONS[bloom] || ['explain'])
    .filter(op => !used.includes(op.toLowerCase()));
  return available.length > 0 ? available[0] : BLOOM_COGNITIVE_OPERATIONS[bloom][0];
}

/**
 * Select appropriate answer type for bloom level
 */
function selectAnswerType(bloom: string): string {
  const types = ANSWER_TYPE_BY_BLOOM[bloom] || ['explanation'];
  return types[Math.floor(Math.random() * types.length)];
}

function markConceptUsed(registry: GenerationRegistry, topic: string, concept: string): void {
  if (!registry.usedConcepts[topic]) {
    registry.usedConcepts[topic] = [];
  }
  registry.usedConcepts[topic].push(concept.toLowerCase());
}

function markOperationUsed(registry: GenerationRegistry, topic: string, bloom: string, operation: string): void {
  const key = `${topic.toLowerCase()}_${bloom.toLowerCase()}`;
  if (!registry.usedOperations[key]) {
    registry.usedOperations[key] = [];
  }
  registry.usedOperations[key].push(operation.toLowerCase());
}

function markPairUsed(registry: GenerationRegistry, concept: string, operation: string): void {
  registry.usedPairs.push(`${concept.toLowerCase()}::${operation.toLowerCase()}`);
}

/**
 * Generate questions using intent-driven prompt with hard constraints
 */
async function generateQuestionsWithIntents(
  topic: string,
  bloom: string,
  intents: Array<{
    slot: Slot;
    concept: string;
    operation: string;
    answerType: string;
    difficulty: string;
    knowledgeDimension: string;
  }>,
  apiKey: string,
  registry: GenerationRegistry
): Promise<any[]> {
  const normalizedBloom = bloom.charAt(0).toUpperCase() + bloom.slice(1).toLowerCase();
  
  // Build the hard constraint prompt
  const questionsSpec = intents.map((intent, idx) => `
Question ${idx + 1}:
  ASSIGNED CONCEPT: "${intent.concept}" (MUST target exactly this)
  REQUIRED OPERATION: "${intent.operation}" (MUST require exactly this cognitive action)
  ANSWER TYPE: "${intent.answerType}" (MUST produce exactly this structure)
  DIFFICULTY: "${intent.difficulty}"
  KNOWLEDGE DIMENSION: "${intent.knowledgeDimension}"
`).join('\n');

  const usedTexts = registry.usedQuestionTexts.slice(-10).map(t => t.substring(0, 100));
  
  const prompt = `Generate ${intents.length} DISTINCT multiple-choice exam questions.

🚨 HARD CONSTRAINTS - VIOLATION = REJECTION 🚨

TOPIC: ${topic}
BLOOM'S LEVEL: ${normalizedBloom}

=== ALREADY USED (DO NOT REPEAT OR PARAPHRASE) ===
${usedTexts.length > 0 ? usedTexts.map((t, i) => `${i + 1}. "${t}..."`).join('\n') : 'None yet'}

=== QUESTION SPECIFICATIONS ===
${questionsSpec}

=== CRITICAL RULES ===
1. Each question MUST target ONLY its assigned concept - no substitutions
2. Each question MUST require EXACTLY its assigned cognitive operation to answer
3. Questions MUST be COMPLETELY DIFFERENT from each other - different phrasing, different focus
4. The TOPIC "${topic}" must appear explicitly in each question text
5. NEVER use the same sentence structure twice
6. NEVER ask the same thing in different words

=== NON-REDUNDANCY EXAMPLES ===
REDUNDANT (BAD):
- "Explain the key factors of ${topic}."
- "Describe the important factors of ${topic}."
- "What are the main factors of ${topic}?"

NON-REDUNDANT (GOOD):
- "Define ${topic} and identify its three primary components." (Remembering - definition)
- "Explain HOW ${topic} prevents data inconsistencies in multi-user environments." (Understanding - explanation)
- "A company is experiencing ${topic} failures. Diagnose the root cause." (Analyzing - analysis)

=== MCQ FORMAT ===
- 4 choices (A, B, C, D)
- One correct answer
- Plausible distractors that test understanding
- Correct answer must match the required answer_type structure

Return ONLY valid JSON:
{
  "questions": [
    {
      "text": "Question targeting [assigned_concept] requiring [assigned_operation]",
      "choices": {"A": "...", "B": "...", "C": "...", "D": "..."},
      "correct_answer": "A",
      "answer": "Model answer demonstrating the answer_type structure",
      "targeted_concept": "the exact concept this question targets",
      "cognitive_operation": "the exact operation required to answer",
      "why_unique": "How this differs from other questions"
    }
  ]
}`;

  console.log(`🤖 Generating ${intents.length} questions for ${topic}/${normalizedBloom}`);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an expert educational content RENDERER implementing a constrained question generation pipeline. You do NOT make creative decisions. All structural decisions have been made for you. Your ONLY job is to render questions that exactly match the assigned constraints. Each question must be completely unique.`
        },
        { role: 'user', content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 3000
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('OpenAI API error:', error);
    throw new Error('Failed to generate questions from AI service');
  }

  const aiResponse = await response.json();
  
  let generatedQuestions;
  try {
    const content = aiResponse.choices[0].message.content;
    generatedQuestions = JSON.parse(content);
  } catch (parseError) {
    console.error('Failed to parse AI response:', parseError);
    throw new Error('Invalid response format from AI service');
  }

  // STEP 6: Validate and format questions
  const questions = (generatedQuestions.questions || []).map((q: any, idx: number) => {
    const intent = intents[idx];
    
    return {
      id: crypto.randomUUID(),
      question_text: q.text,
      question_type: 'mcq',
      choices: q.choices,
      correct_answer: q.correct_answer,
      topic: topic,
      bloom_level: normalizedBloom,
      difficulty: intent?.difficulty || 'average',
      knowledge_dimension: intent?.knowledgeDimension || 'conceptual',
      created_by: 'ai',
      approved: false,
      ai_confidence_score: 0.85,
      needs_review: true,
      targeted_concept: q.targeted_concept || intent?.concept,
      cognitive_operation: q.cognitive_operation || intent?.operation,
      why_unique: q.why_unique,
      metadata: {
        generated_by: 'intent_driven_pipeline',
        pipeline_version: '2.0',
        assigned_concept: intent?.concept,
        assigned_operation: intent?.operation,
        answer_type: intent?.answerType
      }
    };
  }).filter((q: any) => q.question_text && q.question_text.length > 10);

  console.log(`✅ Generated ${questions.length} valid questions`);
  return questions;
}

// ============= MAIN HANDLER =============

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: GenerationInput = await req.json();
    
    if (!body.tos_id || !body.total_items || !body.distributions) {
      throw new Error('Missing required fields: tos_id, total_items, distributions');
    }

    console.log(`\n🎯 === SLOT-BASED TOS GENERATION ===`);
    console.log(`📋 TOS ID: ${body.tos_id}`);
    console.log(`📊 Total items requested: ${body.total_items}`);
    console.log(`📚 Topics: ${body.distributions.map(d => d.topic).join(', ')}`);

    // Initialize registry for session-level redundancy prevention
    const registry: GenerationRegistry = {
      usedConcepts: {},
      usedOperations: {},
      usedPairs: [],
      usedQuestionTexts: []
    };

    // STEP 1 & 2: Lock TOS and expand into slots
    const allSlots = expandTOSToSlots(body.distributions);

    // STEP 4: Attempt retrieval from bank first
    const { filled: bankFilled, unfilled } = await fillSlotsFromBank(
      allSlots,
      registry,
      body.allow_unapproved ?? false
    );

    // STEP 5: Generate AI questions only for unfilled slots
    const aiFilled = await fillSlotsWithAI(unfilled, registry);

    // STEP 7: Assemble final test (preserve slot order)
    const allFilledSlots = [...bankFilled, ...aiFilled];
    const finalQuestions = allSlots
      .filter(s => s.filled && s.question)
      .map(s => s.question)
      .slice(0, body.total_items);

    // Calculate statistics
    const stats = {
      total_generated: finalQuestions.length,
      slots_created: allSlots.length,
      from_bank: bankFilled.length,
      ai_generated: aiFilled.filter(s => s.filled).length,
      unfilled: allSlots.length - allFilledSlots.length,
      by_bloom: finalQuestions.reduce((acc: Record<string, number>, q: any) => {
        const level = q.bloom_level?.toLowerCase() || 'unknown';
        acc[level] = (acc[level] || 0) + 1;
        return acc;
      }, {}),
      by_difficulty: finalQuestions.reduce((acc: Record<string, number>, q: any) => {
        acc[q.difficulty || 'average'] = (acc[q.difficulty || 'average'] || 0) + 1;
        return acc;
      }, {}),
      by_topic: finalQuestions.reduce((acc: Record<string, number>, q: any) => {
        acc[q.topic] = (acc[q.topic] || 0) + 1;
        return acc;
      }, {}),
      needs_review: finalQuestions.filter((q: any) => q.needs_review).length,
      registry_summary: {
        concepts_used: Object.values(registry.usedConcepts).flat().length,
        operations_used: Object.values(registry.usedOperations).flat().length,
        pairs_used: registry.usedPairs.length
      }
    };

    console.log(`\n✅ === GENERATION COMPLETE ===`);
    console.log(`📊 Total: ${stats.total_generated} questions`);
    console.log(`📚 From Bank: ${stats.from_bank}`);
    console.log(`🤖 AI Generated: ${stats.ai_generated}`);
    console.log(`⚠️ Unfilled: ${stats.unfilled}`);

    return new Response(JSON.stringify({
      success: true,
      questions: finalQuestions,
      generation_log: allSlots.map(s => ({
        slot_id: s.id,
        topic: s.topic,
        bloom: s.bloomLevel,
        difficulty: s.difficulty,
        filled: s.filled,
        source: s.source || 'unfilled'
      })),
      statistics: stats,
      tos_id: body.tos_id
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('Generation error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: `Question generation failed: ${message}` }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
