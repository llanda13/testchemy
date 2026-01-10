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
  force_ai_generation?: boolean;
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
  questionType: 'mcq' | 'true_false' | 'short_answer' | 'essay';  // Question type assignment
  points: number;  // Point value
  filled: boolean;
  question?: any;
  source?: 'bank' | 'ai';
}

/**
 * Registry for tracking used concepts/operations across entire session
 */
interface GenerationRegistry {
  usedConcepts: Record<string, string[]>;
  usedOperations: Record<string, string[]>;
  usedPairs: string[];
  usedQuestionTexts: string[];
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

// POINT VALUES
const POINTS = {
  mcq: 1,
  true_false: 1,
  short_answer: 1,
  essay: 5
};

// Randomly choose either True/False OR Short Answer for each exam (mutually exclusive)
function chooseSecondaryQuestionType(): 'true_false' | 'short_answer' {
  return Math.random() < 0.5 ? 'true_false' : 'short_answer';
}

// ============= SUPABASE CLIENT =============

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// ============= QUESTION TYPE DISTRIBUTION =============

/**
 * Calculate how many of each question type to generate
 * Rules:
 * - Essay: 5 points each, calculated based on total points target
 *   - For 46-50 total points: 1 essay (5 points)
 *   - For 100+ total items: max 2 essays (10 points)
 * - True/False OR Short Answer: 1 point each, ~15-20% of remaining items (MUTUALLY EXCLUSIVE)
 * - MCQ: 1 point each, majority (remaining items)
 * 
 * Point calculation example:
 * - 50 questions total → target ~50 points
 * - 1 essay (5 pts) + 49 MCQ/TF (49 pts) = 54 total points
 */
interface QuestionTypeDistribution {
  mcq: number;
  true_false: number;
  short_answer: number;
  essay: number;
  secondaryType: 'true_false' | 'short_answer';
  totalPoints: number;
}

function calculateQuestionTypeDistribution(totalItems: number): QuestionTypeDistribution {
  // Essay allocation based on total items and point balance
  // Rule: Essay questions should not dominate the total points
  // Essay = 5 pts, so max essays = floor((totalItems * 0.10) / 5) = ~10% of total points from essays
  
  let essayCount = 0;
  
  // For very small exams (< 20 items), no essay
  if (totalItems < 20) {
    essayCount = 0;
  }
  // For 20-59 items: 1 essay max
  else if (totalItems < 60) {
    essayCount = 1;
  }
  // For 60-99 items: 1 essay, could be 2
  else if (totalItems < 100) {
    essayCount = 1;
  }
  // For 100+ items: 2 essays max
  else {
    essayCount = 2;
  }
  
  const remainingAfterEssay = totalItems - essayCount;
  
  // Choose either True/False OR Short Answer (mutually exclusive per exam)
  const secondaryType = chooseSecondaryQuestionType();
  
  // Secondary type (T/F or Short Answer): ~15-20% of remaining, minimum 0
  const secondaryCount = Math.max(0, Math.floor(remainingAfterEssay * 0.18));
  
  // MCQ: Everything else (majority)
  const mcqCount = remainingAfterEssay - secondaryCount;
  
  // Calculate total points
  const totalPoints = (mcqCount * POINTS.mcq) + 
                      (secondaryCount * (secondaryType === 'true_false' ? POINTS.true_false : POINTS.short_answer)) + 
                      (essayCount * POINTS.essay);
  
  console.log(`📊 Question type distribution for ${totalItems} items:`);
  console.log(`   MCQ: ${mcqCount} (${mcqCount * POINTS.mcq} pts)`);
  console.log(`   ${secondaryType === 'true_false' ? 'T/F' : 'Short Answer'}: ${secondaryCount} (${secondaryCount} pts)`);
  console.log(`   Essay: ${essayCount} (${essayCount * POINTS.essay} pts)`);
  console.log(`   Total Points: ${totalPoints}`);
  
  return {
    mcq: mcqCount,
    true_false: secondaryType === 'true_false' ? secondaryCount : 0,
    short_answer: secondaryType === 'short_answer' ? secondaryCount : 0,
    essay: essayCount,
    secondaryType,
    totalPoints
  };
}

// ============= SLOT GENERATION =============

/**
 * STEP 1: Lock the TOS and expand into slots with question types
 */
function expandTOSToSlots(distributions: TopicDistribution[], totalItems: number): Slot[] {
  const slots: Slot[] = [];
  let slotId = 1;

  // Calculate question type distribution
  const typeDistribution = calculateQuestionTypeDistribution(totalItems);
  
  // Track how many of each type we've assigned
  let assignedEssay = 0;
  let assignedSecondary = 0; // Either T/F or Short Answer (mutually exclusive)
  const secondaryType = typeDistribution.secondaryType; // 'true_false' or 'short_answer'
  const secondaryCount = secondaryType === 'true_false' ? typeDistribution.true_false : typeDistribution.short_answer;

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
          const knowledgeDimension = BLOOM_KNOWLEDGE_MAPPING[bloom] || 'conceptual';
          
          // Assign question type based on bloom level and remaining quotas
          let questionType: 'mcq' | 'true_false' | 'short_answer' | 'essay' = 'mcq';
          let points = POINTS.mcq;
          
          // Essay: Only for higher-order blooms (evaluating, creating) and difficult
          if (assignedEssay < typeDistribution.essay && 
              (bloom === 'evaluating' || bloom === 'creating') && 
              level === 'difficult') {
            questionType = 'essay';
            points = POINTS.essay;
            assignedEssay++;
          }
          // Secondary type (either T/F OR Short Answer - mutually exclusive per exam)
          else if (assignedSecondary < secondaryCount) {
            // True/False: Good for remembering/understanding, easy/average difficulty
            if (secondaryType === 'true_false' && 
                (bloom === 'remembering' || bloom === 'understanding') && 
                (level === 'easy' || level === 'average')) {
              questionType = 'true_false';
              points = POINTS.true_false;
              assignedSecondary++;
            }
            // Short Answer: Good for applying/analyzing, average difficulty
            else if (secondaryType === 'short_answer' && 
                     (bloom === 'applying' || bloom === 'understanding' || bloom === 'analyzing') && 
                     (level === 'average' || level === 'easy')) {
              questionType = 'short_answer';
              points = POINTS.short_answer;
              assignedSecondary++;
            }
          }
          // MCQ: Default for everything else
          
          slots.push({
            id: `slot_${slotId++}`,
            topic,
            bloomLevel: bloom,
            difficulty: level,
            knowledgeDimension,
            questionType,
            points,
            filled: false
          });
        }
      }
    }
  }

  // If we haven't filled essay quota, convert some difficult MCQs
  if (assignedEssay < typeDistribution.essay) {
    const difficultMCQs = slots.filter(s => 
      s.questionType === 'mcq' && 
      s.difficulty === 'difficult' &&
      (s.bloomLevel === 'analyzing' || s.bloomLevel === 'evaluating' || s.bloomLevel === 'creating')
    );
    
    for (const slot of difficultMCQs) {
      if (assignedEssay >= typeDistribution.essay) break;
      slot.questionType = 'essay';
      slot.points = POINTS.essay;
      assignedEssay++;
    }
  }

  // If we haven't filled secondary quota, convert some easy/average MCQs
  if (assignedSecondary < secondaryCount) {
    const eligibleMCQs = slots.filter(s => 
      s.questionType === 'mcq' && 
      (s.difficulty === 'easy' || s.difficulty === 'average')
    );
    
    for (const slot of eligibleMCQs) {
      if (assignedSecondary >= secondaryCount) break;
      slot.questionType = secondaryType;
      slot.points = secondaryType === 'true_false' ? POINTS.true_false : POINTS.short_answer;
      assignedSecondary++;
    }
  }

  const typeCounts = {
    mcq: slots.filter(s => s.questionType === 'mcq').length,
    true_false: slots.filter(s => s.questionType === 'true_false').length,
    short_answer: slots.filter(s => s.questionType === 'short_answer').length,
    essay: slots.filter(s => s.questionType === 'essay').length
  };
  
  console.log(`📋 Expanded TOS into ${slots.length} slots:`);
  console.log(`   MCQ: ${typeCounts.mcq}`);
  console.log(`   ${secondaryType === 'true_false' ? 'T/F' : 'Short Answer'}: ${secondaryType === 'true_false' ? typeCounts.true_false : typeCounts.short_answer}`);
  console.log(`   Essay: ${typeCounts.essay}`);
  console.log(`   (Note: Only ${secondaryType === 'true_false' ? 'True/False' : 'Short Answer'} used - mutually exclusive)`);
  
  return slots;
}

// ============= BANK RETRIEVAL =============

async function fillSlotsFromBank(
  slots: Slot[],
  registry: GenerationRegistry,
  allowUnapproved: boolean
): Promise<{ filled: Slot[]; unfilled: Slot[] }> {
  const filled: Slot[] = [];
  const unfilled: Slot[] = [];

  // Group slots by topic+bloom+difficulty+type for efficient querying
  const slotGroups = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = `${slot.topic}::${slot.bloomLevel}::${slot.difficulty}::${slot.questionType}`;
    if (!slotGroups.has(key)) {
      slotGroups.set(key, []);
    }
    slotGroups.get(key)!.push(slot);
  }

  for (const [key, groupSlots] of slotGroups) {
    const [topic, bloom, difficulty, questionType] = key.split('::');
    
    const normalizedBloom = bloom.charAt(0).toUpperCase() + bloom.slice(1).toLowerCase();
    const bloomVariants = Array.from(new Set([bloom, bloom.toLowerCase(), normalizedBloom]));

    let query = supabase
      .from('questions')
      .select('*')
      .eq('deleted', false)
      .eq('difficulty', difficulty)
      .eq('question_type', questionType)
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

    const availableQuestions = [...(bankQuestions || [])];
    
    for (const slot of groupSlots) {
      const selectedQuestion = selectNonRedundantQuestion(
        availableQuestions,
        registry,
        slot.topic,
        slot.questionType
      );

      if (selectedQuestion) {
        const idx = availableQuestions.findIndex(q => q.id === selectedQuestion.id);
        if (idx > -1) availableQuestions.splice(idx, 1);
        
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

function selectNonRedundantQuestion(
  candidates: any[],
  registry: GenerationRegistry,
  topic: string,
  questionType: string
): any | null {
  for (const candidate of candidates) {
    // For MCQ, validate options exist
    if (questionType === 'mcq') {
      const choices = candidate.choices;
      if (!choices || typeof choices !== 'object') continue;
      const hasAllOptions = ['A', 'B', 'C', 'D'].every(key => choices[key] && choices[key].trim().length > 0);
      if (!hasAllOptions) continue;
      if (!['A', 'B', 'C', 'D'].includes(candidate.correct_answer)) continue;
    }
    
    const text = candidate.question_text?.toLowerCase() || '';
    
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

function registerQuestion(
  registry: GenerationRegistry,
  topic: string,
  bloomLevel: string,
  question: any
): void {
  const text = question.question_text?.toLowerCase() || '';
  registry.usedQuestionTexts.push(text);
  
  const concept = question.targeted_concept || extractConcept(text);
  if (concept) {
    if (!registry.usedConcepts[topic]) {
      registry.usedConcepts[topic] = [];
    }
    registry.usedConcepts[topic].push(concept.toLowerCase());
  }
}

function calculateTextSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(text2.split(/\s+/).filter(w => w.length > 3));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  let intersection = 0;
  words1.forEach(w => { if (words2.has(w)) intersection++; });
  
  return intersection / Math.min(words1.size, words2.size);
}

function extractConcept(text: string): string | null {
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

  // Group by topic+bloom+questionType for batch generation
  const slotGroups = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = `${slot.topic}::${slot.bloomLevel}::${slot.questionType}`;
    if (!slotGroups.has(key)) {
      slotGroups.set(key, []);
    }
    slotGroups.get(key)!.push(slot);
  }

  const filledSlots: Slot[] = [];

  for (const [key, groupSlots] of slotGroups) {
    const [topic, bloom, questionType] = key.split('::');

    let pendingSlots = [...groupSlots];
    let attempt = 0;

    while (pendingSlots.length > 0 && attempt < 3) {
      attempt++;

      const intents = pendingSlots.map(slot => {
        const concept = selectNextConcept(registry, topic);
        const operation = selectNextOperation(registry, topic, bloom);
        const answerType = selectAnswerType(bloom);

        markConceptUsed(registry, topic, concept);
        markOperationUsed(registry, topic, bloom, operation);
        markPairUsed(registry, concept, operation);

        return {
          slot,
          concept,
          operation,
          answerType,
          difficulty: slot.difficulty,
          knowledgeDimension: slot.knowledgeDimension,
          questionType: slot.questionType,
          points: slot.points
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

        for (let i = 0; i < intents.length && i < questions.length; i++) {
          const slot = intents[i].slot;
          const question = questions[i];

          if (question && validateQuestion(question, slot.questionType)) {
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
 * Validate question structure based on type
 */
function validateQuestion(question: any, questionType: string): boolean {
  if (!question.question_text || question.question_text.length < 10) {
    return false;
  }

  if (questionType === 'mcq') {
    // ENFORCE: Must have exactly 4 options A, B, C, D
    const choices = question.choices;
    if (!choices || typeof choices !== 'object') {
      console.warn('MCQ missing choices object');
      return false;
    }
    
    const hasAllOptions = ['A', 'B', 'C', 'D'].every(key => 
      choices[key] && typeof choices[key] === 'string' && choices[key].trim().length > 0
    );
    
    if (!hasAllOptions) {
      console.warn('MCQ missing one or more options (A, B, C, D)');
      return false;
    }
    
    // ENFORCE: correct_answer must be A, B, C, or D
    if (!['A', 'B', 'C', 'D'].includes(question.correct_answer)) {
      console.warn(`MCQ has invalid correct_answer: ${question.correct_answer}`);
      return false;
    }
  }

  if (questionType === 'true_false') {
    // ENFORCE: correct_answer must be "True" or "False"
    if (!['True', 'False', 'true', 'false'].includes(String(question.correct_answer))) {
      console.warn(`T/F has invalid correct_answer: ${question.correct_answer}`);
      return false;
    }
  }

  if (questionType === 'short_answer') {
    // ENFORCE: Must have a correct_answer or model answer
    if (!question.correct_answer && !question.answer) {
      console.warn('Short answer missing correct_answer');
      return false;
    }
  }

  if (questionType === 'essay') {
    // Essay should have rubric or model answer
    if (!question.answer && !question.rubric) {
      console.warn('Essay missing model answer or rubric');
      // Don't reject, just warn - essays are harder to generate
    }
  }

  return true;
}

function selectNextConcept(registry: GenerationRegistry, topic: string): string {
  const used = registry.usedConcepts[topic] || [];
  const available = CONCEPT_POOL.filter(c => !used.includes(c.toLowerCase()));
  return available.length > 0 ? available[0] : CONCEPT_POOL[used.length % CONCEPT_POOL.length];
}

function selectNextOperation(registry: GenerationRegistry, topic: string, bloom: string): string {
  const key = `${topic.toLowerCase()}_${bloom.toLowerCase()}`;
  const used = registry.usedOperations[key] || [];
  const available = (BLOOM_COGNITIVE_OPERATIONS[bloom] || ['explain'])
    .filter(op => !used.includes(op.toLowerCase()));
  return available.length > 0 ? available[0] : BLOOM_COGNITIVE_OPERATIONS[bloom][0];
}

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
 * Generate questions using intent-driven prompt with strict format enforcement
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
    questionType: string;
    points: number;
  }>,
  apiKey: string,
  registry: GenerationRegistry
): Promise<any[]> {
  const normalizedBloom = bloom.charAt(0).toUpperCase() + bloom.slice(1).toLowerCase();
  
  // Group by question type for appropriate prompts
  const mcqIntents = intents.filter(i => i.questionType === 'mcq');
  const tfIntents = intents.filter(i => i.questionType === 'true_false');
  const shortAnswerIntents = intents.filter(i => i.questionType === 'short_answer');
  const essayIntents = intents.filter(i => i.questionType === 'essay');

  const allQuestions: any[] = [];

  // Generate MCQ questions
  if (mcqIntents.length > 0) {
    const mcqQuestions = await generateMCQQuestions(topic, normalizedBloom, mcqIntents, apiKey, registry);
    allQuestions.push(...mcqQuestions);
  }

  // Generate True/False questions
  if (tfIntents.length > 0) {
    const tfQuestions = await generateTrueFalseQuestions(topic, normalizedBloom, tfIntents, apiKey, registry);
    allQuestions.push(...tfQuestions);
  }

  // Generate Short Answer / Fill in the Blank questions
  if (shortAnswerIntents.length > 0) {
    const shortAnswerQuestions = await generateShortAnswerQuestions(topic, normalizedBloom, shortAnswerIntents, apiKey, registry);
    allQuestions.push(...shortAnswerQuestions);
  }

  // Generate Essay questions
  if (essayIntents.length > 0) {
    const essayQuestions = await generateEssayQuestions(topic, normalizedBloom, essayIntents, apiKey, registry);
    allQuestions.push(...essayQuestions);
  }

  return allQuestions;
}

/**
 * Generate MCQ questions with ENFORCED A, B, C, D options
 */
async function generateMCQQuestions(
  topic: string,
  bloom: string,
  intents: any[],
  apiKey: string,
  registry: GenerationRegistry
): Promise<any[]> {
  const questionsSpec = intents.map((intent, idx) => `
Question ${idx + 1}:
  ASSIGNED CONCEPT: "${intent.concept}"
  REQUIRED OPERATION: "${intent.operation}"
  DIFFICULTY: "${intent.difficulty}"
`).join('\n');

  const usedTexts = registry.usedQuestionTexts.slice(-10).map(t => t.substring(0, 100));
  
  const prompt = `Generate ${intents.length} DISTINCT Multiple Choice Questions (MCQs).

🚨 CRITICAL MCQ FORMAT REQUIREMENTS - MUST BE FOLLOWED EXACTLY 🚨

TOPIC: ${topic}
BLOOM'S LEVEL: ${bloom}

=== ALREADY USED (DO NOT REPEAT) ===
${usedTexts.length > 0 ? usedTexts.map((t, i) => `${i + 1}. "${t}..."`).join('\n') : 'None yet'}

=== QUESTION SPECIFICATIONS ===
${questionsSpec}

=== MCQ FORMAT - STRICTLY ENFORCED ===
Each MCQ MUST have:
1. A clear question stem
2. EXACTLY 4 options labeled A, B, C, D
3. Each option MUST be a complete, substantive answer (not blank)
4. ONE correct answer (A, B, C, or D)
5. Three plausible distractors that test understanding
6. Distractors should be related to the topic but incorrect
7. correct_answer must be RANDOMIZED (not always "A")

=== DISTRACTOR QUALITY RULES ===
- Distractors must be plausible (could fool someone with partial knowledge)
- Distractors must be clearly wrong to someone who knows the material
- Distractors should not be obviously absurd
- Each option should be similar in length and complexity

Return ONLY valid JSON:
{
  "questions": [
    {
      "text": "Question stem about ${topic}?",
      "choices": {
        "A": "First option text (complete sentence or phrase)",
        "B": "Second option text (complete sentence or phrase)",
        "C": "Third option text (complete sentence or phrase)",
        "D": "Fourth option text (complete sentence or phrase)"
      },
      "correct_answer": "B",
      "explanation": "Why B is correct and others are wrong"
    }
  ]
}`;

  console.log(`🤖 Generating ${intents.length} MCQ questions for ${topic}/${bloom}`);

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
          content: `You are an expert educational assessment designer. Generate high-quality Multiple Choice Questions with EXACTLY 4 options (A, B, C, D). Each option must be substantive and plausible. The correct answer should be randomized - not always "A". Never generate questions with blank or placeholder options.`
        },
        { role: 'user', content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 3000
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('OpenAI API error for MCQ:', error);
    throw new Error('Failed to generate MCQ questions');
  }

  const aiResponse = await response.json();
  
  let generatedQuestions;
  try {
    const content = aiResponse.choices[0].message.content;
    generatedQuestions = JSON.parse(content);
  } catch (parseError) {
    console.error('Failed to parse MCQ response:', parseError);
    throw new Error('Invalid MCQ response format');
  }

  return (generatedQuestions.questions || []).map((q: any, idx: number) => {
    const intent = intents[idx];
    
    // Validate and fix choices if needed
    let choices = q.choices || {};
    let correctAnswer = q.correct_answer || 'A';
    
    // Ensure all 4 options exist
    ['A', 'B', 'C', 'D'].forEach(key => {
      if (!choices[key] || typeof choices[key] !== 'string' || choices[key].trim().length === 0) {
        choices[key] = `Option ${key} for ${topic}`;
      }
    });
    
    // Ensure correct_answer is valid
    if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) {
      correctAnswer = 'A';
    }
    
    return {
      id: crypto.randomUUID(),
      question_text: q.text,
      question_type: 'mcq',
      choices: choices,
      correct_answer: correctAnswer,
      explanation: q.explanation,
      topic: topic,
      bloom_level: bloom,
      difficulty: intent?.difficulty || 'average',
      knowledge_dimension: intent?.knowledgeDimension || 'conceptual',
      points: POINTS.mcq,
      created_by: 'ai',
      approved: false,
      ai_confidence_score: 0.85,
      needs_review: true,
      metadata: {
        generated_by: 'intent_driven_pipeline',
        pipeline_version: '2.1',
        question_type: 'mcq'
      }
    };
  }).filter((q: any) => q.question_text && q.question_text.length > 10);
}

/**
 * Generate True/False questions
 */
async function generateTrueFalseQuestions(
  topic: string,
  bloom: string,
  intents: any[],
  apiKey: string,
  registry: GenerationRegistry
): Promise<any[]> {
  const questionsSpec = intents.map((intent, idx) => `
Question ${idx + 1}:
  CONCEPT: "${intent.concept}"
  DIFFICULTY: "${intent.difficulty}"
`).join('\n');

  const prompt = `Generate ${intents.length} DISTINCT True/False questions.

TOPIC: ${topic}
BLOOM'S LEVEL: ${bloom}

=== QUESTION SPECIFICATIONS ===
${questionsSpec}

=== TRUE/FALSE FORMAT ===
1. Statement must be clearly TRUE or FALSE (no ambiguity)
2. Use factual statements about ${topic}
3. Avoid trick questions or double negatives
4. Statement should test understanding, not just memorization
5. Balance between True and False answers

Return ONLY valid JSON:
{
  "questions": [
    {
      "text": "Statement about ${topic} that is either true or false.",
      "correct_answer": "True",
      "explanation": "Why this statement is true/false"
    }
  ]
}`;

  console.log(`🤖 Generating ${intents.length} T/F questions for ${topic}/${bloom}`);

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
          content: `You are an expert educational assessment designer. Generate clear True/False questions where the statement is unambiguously true or false. Balance the answers between True and False.`
        },
        { role: 'user', content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 2000
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('OpenAI API error for T/F:', error);
    throw new Error('Failed to generate T/F questions');
  }

  const aiResponse = await response.json();
  
  let generatedQuestions;
  try {
    const content = aiResponse.choices[0].message.content;
    generatedQuestions = JSON.parse(content);
  } catch (parseError) {
    console.error('Failed to parse T/F response:', parseError);
    throw new Error('Invalid T/F response format');
  }

  return (generatedQuestions.questions || []).map((q: any, idx: number) => {
    const intent = intents[idx];
    
    // Normalize correct_answer
    let correctAnswer = String(q.correct_answer || 'True');
    if (correctAnswer.toLowerCase() === 'true') correctAnswer = 'True';
    else if (correctAnswer.toLowerCase() === 'false') correctAnswer = 'False';
    else correctAnswer = 'True';
    
    return {
      id: crypto.randomUUID(),
      question_text: q.text,
      question_type: 'true_false',
      choices: { 'True': 'True', 'False': 'False' },
      correct_answer: correctAnswer,
      explanation: q.explanation,
      topic: topic,
      bloom_level: bloom,
      difficulty: intent?.difficulty || 'easy',
      knowledge_dimension: intent?.knowledgeDimension || 'factual',
      points: POINTS.true_false,
      created_by: 'ai',
      approved: false,
      ai_confidence_score: 0.85,
      needs_review: true,
      metadata: {
        generated_by: 'intent_driven_pipeline',
        pipeline_version: '2.1',
        question_type: 'true_false'
      }
    };
  }).filter((q: any) => q.question_text && q.question_text.length > 10);
}

/**
 * Generate Short Answer / Fill in the Blank questions
 */
async function generateShortAnswerQuestions(
  topic: string,
  bloom: string,
  intents: any[],
  apiKey: string,
  registry: GenerationRegistry
): Promise<any[]> {
  const questionsSpec = intents.map((intent, idx) => `
Question ${idx + 1}:
  CONCEPT: "${intent.concept}"
  OPERATION: "${intent.operation}"
  DIFFICULTY: "${intent.difficulty}"
`).join('\n');

  const prompt = `Generate ${intents.length} DISTINCT Short Answer / Fill in the Blank questions.

TOPIC: ${topic}
BLOOM'S LEVEL: ${bloom}

=== QUESTION SPECIFICATIONS ===
${questionsSpec}

=== SHORT ANSWER FORMAT ===
1. Question should require a brief, specific answer (1-3 words or a short phrase)
2. Include a clear blank or question requiring a specific term/concept
3. Answer should be unambiguous and verifiable
4. Test understanding of key terms, definitions, or concepts
5. Avoid questions with multiple correct answers

=== EXAMPLE FORMATS ===
- "The process by which plants convert sunlight to energy is called ________."
- "What is the name of the smallest unit of life?"
- "In programming, a ________ stores a value that can change during execution."

Return ONLY valid JSON:
{
  "questions": [
    {
      "text": "The ________ is the central concept in ${topic}.",
      "correct_answer": "specific term or phrase",
      "acceptable_answers": ["term", "alternative phrasing"],
      "explanation": "Why this is the correct answer"
    }
  ]
}`;

  console.log(`🤖 Generating ${intents.length} Short Answer questions for ${topic}/${bloom}`);

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
          content: `You are an expert educational assessment designer. Generate clear Short Answer / Fill in the Blank questions that have unambiguous, specific answers. Include acceptable alternative phrasings when appropriate.`
        },
        { role: 'user', content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 2000
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('OpenAI API error for Short Answer:', error);
    throw new Error('Failed to generate Short Answer questions');
  }

  const aiResponse = await response.json();
  
  let generatedQuestions;
  try {
    const content = aiResponse.choices[0].message.content;
    generatedQuestions = JSON.parse(content);
  } catch (parseError) {
    console.error('Failed to parse Short Answer response:', parseError);
    throw new Error('Invalid Short Answer response format');
  }

  return (generatedQuestions.questions || []).map((q: any, idx: number) => {
    const intent = intents[idx];
    
    return {
      id: crypto.randomUUID(),
      question_text: q.text,
      question_type: 'short_answer',
      correct_answer: q.correct_answer,
      acceptable_answers: q.acceptable_answers || [q.correct_answer],
      explanation: q.explanation,
      topic: topic,
      bloom_level: bloom,
      difficulty: intent?.difficulty || 'average',
      knowledge_dimension: intent?.knowledgeDimension || 'factual',
      points: POINTS.short_answer,
      created_by: 'ai',
      approved: false,
      ai_confidence_score: 0.85,
      needs_review: true,
      metadata: {
        generated_by: 'intent_driven_pipeline',
        pipeline_version: '2.1',
        question_type: 'short_answer'
      }
    };
  }).filter((q: any) => q.question_text && q.question_text.length > 10);
}

/**
 * Generate Essay questions (limited count, high value)
 */
async function generateEssayQuestions(
  topic: string,
  bloom: string,
  intents: any[],
  apiKey: string,
  registry: GenerationRegistry
): Promise<any[]> {
  const questionsSpec = intents.map((intent, idx) => `
Essay ${idx + 1}:
  CONCEPT: "${intent.concept}"
  REQUIRED THINKING: "${intent.operation}"
  DIFFICULTY: "${intent.difficulty}"
`).join('\n');

  const prompt = `Generate ${intents.length} Essay questions worth 5 points each.

TOPIC: ${topic}
BLOOM'S LEVEL: ${bloom} (Higher-order thinking)

=== ESSAY SPECIFICATIONS ===
${questionsSpec}

=== ESSAY FORMAT ===
1. Question should require extended written response
2. Should test higher-order thinking (analysis, evaluation, synthesis)
3. Should have clear rubric criteria for scoring
4. Worth 5 points - question complexity should match

Return ONLY valid JSON:
{
  "questions": [
    {
      "text": "Essay question requiring analysis/evaluation/synthesis about ${topic}",
      "rubric": {
        "5_points": "Excellent: Comprehensive analysis with...",
        "4_points": "Good: Solid understanding with...",
        "3_points": "Satisfactory: Basic understanding with...",
        "2_points": "Developing: Limited understanding with...",
        "1_point": "Beginning: Minimal understanding with..."
      },
      "model_answer": "A model answer that demonstrates full understanding..."
    }
  ]
}`;

  console.log(`🤖 Generating ${intents.length} Essay questions for ${topic}/${bloom}`);

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
          content: `You are an expert educational assessment designer. Generate high-quality essay questions that test higher-order thinking skills. Include a clear rubric for 5-point scoring.`
        },
        { role: 'user', content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 3000
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('OpenAI API error for Essay:', error);
    throw new Error('Failed to generate Essay questions');
  }

  const aiResponse = await response.json();
  
  let generatedQuestions;
  try {
    const content = aiResponse.choices[0].message.content;
    generatedQuestions = JSON.parse(content);
  } catch (parseError) {
    console.error('Failed to parse Essay response:', parseError);
    throw new Error('Invalid Essay response format');
  }

  return (generatedQuestions.questions || []).map((q: any, idx: number) => {
    const intent = intents[idx];
    
    return {
      id: crypto.randomUUID(),
      question_text: q.text,
      question_type: 'essay',
      correct_answer: null,
      answer: q.model_answer,
      rubric: q.rubric,
      topic: topic,
      bloom_level: bloom,
      difficulty: intent?.difficulty || 'difficult',
      knowledge_dimension: intent?.knowledgeDimension || 'metacognitive',
      points: POINTS.essay,
      created_by: 'ai',
      approved: false,
      ai_confidence_score: 0.80,
      needs_review: true,
      metadata: {
        generated_by: 'intent_driven_pipeline',
        pipeline_version: '2.1',
        question_type: 'essay'
      }
    };
  }).filter((q: any) => q.question_text && q.question_text.length > 20);
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

    console.log(`\n🎯 === SLOT-BASED TOS GENERATION v2.1 ===`);
    console.log(`📋 TOS ID: ${body.tos_id}`);
    console.log(`📊 Total items requested: ${body.total_items}`);
    console.log(`📚 Topics: ${body.distributions.map(d => d.topic).join(', ')}`);

    const registry: GenerationRegistry = {
      usedConcepts: {},
      usedOperations: {},
      usedPairs: [],
      usedQuestionTexts: []
    };

    // STEP 1: Expand TOS into slots with question types
    const allSlots = expandTOSToSlots(body.distributions, body.total_items);

    let bankFilled: Slot[] = [];
    let unfilled: Slot[] = allSlots;

    if (!body.force_ai_generation) {
      const bankResult = await fillSlotsFromBank(
        allSlots,
        registry,
        body.allow_unapproved ?? false
      );
      bankFilled = bankResult.filled;
      unfilled = bankResult.unfilled;
    } else {
      console.log(`⚡ force_ai_generation=true: Generating all ${allSlots.length} slots via AI`);
    }

    // STEP 2: Generate AI questions for unfilled slots
    const aiFilled = await fillSlotsWithAI(unfilled, registry);

    // Merge results
    const filledById = new Map<string, Slot>();
    for (const slot of bankFilled) {
      filledById.set(slot.id, slot);
    }
    for (const slot of aiFilled) {
      if (slot.filled && slot.question) {
        filledById.set(slot.id, slot);
      }
    }

    // Assemble final test preserving slot order
    const finalQuestions: any[] = [];
    for (const slot of allSlots) {
      const filledSlot = filledById.get(slot.id);
      if (filledSlot && filledSlot.question) {
        // Add points to question
        filledSlot.question.points = filledSlot.points;
        finalQuestions.push(filledSlot.question);
      }
    }
    
    const trimmedQuestions = finalQuestions.slice(0, body.total_items);
    
    // Calculate statistics by question type
    const typeCounts = {
      mcq: trimmedQuestions.filter(q => q.question_type === 'mcq').length,
      true_false: trimmedQuestions.filter(q => q.question_type === 'true_false').length,
      short_answer: trimmedQuestions.filter(q => q.question_type === 'short_answer').length,
      essay: trimmedQuestions.filter(q => q.question_type === 'essay').length
    };
    
    const totalPoints = trimmedQuestions.reduce((sum, q) => sum + (q.points || 1), 0);
    
    // Determine which secondary type was used
    const secondaryTypeUsed = typeCounts.true_false > 0 ? 'true_false' : 
                              typeCounts.short_answer > 0 ? 'short_answer' : 'none';

    console.log(`📊 Final assembly: ${trimmedQuestions.length} questions`);
    console.log(`   MCQ: ${typeCounts.mcq} (${typeCounts.mcq * POINTS.mcq} pts)`);
    if (typeCounts.true_false > 0) {
      console.log(`   T/F: ${typeCounts.true_false} (${typeCounts.true_false * POINTS.true_false} pts)`);
    }
    if (typeCounts.short_answer > 0) {
      console.log(`   Short Answer: ${typeCounts.short_answer} (${typeCounts.short_answer * POINTS.short_answer} pts)`);
    }
    console.log(`   Essay: ${typeCounts.essay} (${typeCounts.essay * POINTS.essay} pts)`);
    console.log(`   Total Points: ${totalPoints}`);
    console.log(`   (Note: Secondary type used: ${secondaryTypeUsed === 'true_false' ? 'True/False' : secondaryTypeUsed === 'short_answer' ? 'Short Answer' : 'None'})`);


    const stats = {
      total_generated: trimmedQuestions.length,
      total_points: totalPoints,
      slots_created: allSlots.length,
      from_bank: bankFilled.length,
      ai_generated: aiFilled.filter(s => s.filled).length,
      unfilled: allSlots.length - filledById.size,
      by_question_type: typeCounts,
      by_bloom: trimmedQuestions.reduce((acc: Record<string, number>, q: any) => {
        const level = q.bloom_level?.toLowerCase() || 'unknown';
        acc[level] = (acc[level] || 0) + 1;
        return acc;
      }, {}),
      by_difficulty: trimmedQuestions.reduce((acc: Record<string, number>, q: any) => {
        acc[q.difficulty || 'average'] = (acc[q.difficulty || 'average'] || 0) + 1;
        return acc;
      }, {}),
      by_topic: trimmedQuestions.reduce((acc: Record<string, number>, q: any) => {
        acc[q.topic] = (acc[q.topic] || 0) + 1;
        return acc;
      }, {}),
      needs_review: trimmedQuestions.filter((q: any) => q.needs_review).length
    };

    console.log(`\n✅ === GENERATION COMPLETE ===`);

    return new Response(JSON.stringify({
      success: true,
      questions: trimmedQuestions,
      generation_log: allSlots.map(s => {
        const filled = filledById.get(s.id);
        return {
          slot_id: s.id,
          topic: s.topic,
          bloom: s.bloomLevel,
          difficulty: s.difficulty,
          question_type: s.questionType,
          points: s.points,
          filled: filled?.filled ?? false,
          source: filled?.source || 'unfilled'
        };
      }),
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
