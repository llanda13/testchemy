/**
 * Intent-Driven Question Generator
 * 
 * Three-layer pipeline that makes redundancy structurally impossible:
 * 1. Intent Selection (structure) - System decides answer type, concept, and operation
 * 2. Question Generation (wording) - GPT fills in language with ASSIGNED constraints
 * 3. Answer Generation (logic) - GPT creates answer AFTER question exists
 * 
 * GPT is the scribe, not the teacher.
 * 
 * FIX: Now passes concept and cognitive operation to edge function for enforcement.
 */

import { supabase } from '@/integrations/supabase/client';
import type { KnowledgeDimension, AnswerType, QuestionIntent } from '@/types/knowledge';
import { 
  IntentRegistry, 
  selectMultipleIntents, 
  selectNextConceptAndOperation,
  BLOOM_COGNITIVE_OPERATIONS 
} from './intentSelector';
import { getAnswerTypeConstraint } from './intentCompatibility';

// Re-export for external use
export { IntentRegistry } from './intentSelector';

export interface IntentDrivenQuestion {
  text: string;
  answer: string;
  choices?: Record<string, string>;
  correct_answer?: string;
  intent: QuestionIntent;
  difficulty: string;
  bloom_alignment_note?: string;
  knowledge_alignment_note?: string;
  answer_type_note?: string;
  assigned_concept?: string;
  assigned_operation?: string;
}

export interface IntentDrivenGenerationResult {
  success: boolean;
  questions: IntentDrivenQuestion[];
  intentsUsed: QuestionIntent[];
  error?: string;
}

interface GenerationParams {
  topic: string;
  bloomLevel: string;
  knowledgeDimension: KnowledgeDimension;
  difficulty?: string;
  count?: number;
  questionType?: 'mcq' | 'essay';
  registry?: IntentRegistry;
}

/**
 * Build intent payloads with concept and operation assignments
 * This is the key fix - GPT receives exactly what to use
 */
function buildIntentPayloads(
  intents: QuestionIntent[],
  registry: IntentRegistry
): Array<{
  answer_type: string;
  answer_type_constraint: string;
  assigned_concept: string;
  assigned_operation: string;
  forbidden_patterns: string[];
}> {
  return intents.map(intent => {
    // Select unique concept and operation for this intent
    const conceptAndOp = selectNextConceptAndOperation(
      registry,
      intent.topic,
      intent.bloomLevel
    );
    
    const concept = conceptAndOp?.concept || 'core principles';
    const operation = conceptAndOp?.operation || 'explain';
    
    // Mark as used immediately to prevent reuse
    if (conceptAndOp) {
      registry.markConceptUsed(intent.topic, concept);
      registry.markOperationUsed(intent.topic, intent.bloomLevel, operation);
    }
    
    // Get forbidden patterns for this bloom level
    const bloomConfig = BLOOM_COGNITIVE_OPERATIONS[intent.bloomLevel];
    const forbiddenPatterns = bloomConfig?.forbiddenPatterns || [];
    
    return {
      answer_type: intent.answerType,
      answer_type_constraint: getAnswerTypeConstraint(intent.answerType),
      assigned_concept: concept,
      assigned_operation: operation,
      forbidden_patterns: forbiddenPatterns
    };
  });
}

/**
 * Generate questions using the intent-driven pipeline
 * Redundancy is prevented by design, not detection
 */
export async function generateWithIntent(
  params: GenerationParams
): Promise<IntentDrivenGenerationResult> {
  const {
    topic,
    bloomLevel,
    knowledgeDimension,
    difficulty = 'Average',
    count = 1,
    questionType = 'mcq',
    registry = new IntentRegistry()
  } = params;

  // Layer 1: Select intents (system decides structure)
  const intents = selectMultipleIntents(
    registry,
    topic,
    bloomLevel,
    knowledgeDimension,
    count
  );

  if (intents.length === 0) {
    return {
      success: false,
      questions: [],
      intentsUsed: [],
      error: `No available answer types for ${topic}/${bloomLevel}/${knowledgeDimension}. All valid combinations exhausted.`
    };
  }

  // NEW: Build intent payloads with concept and operation assignments
  const intentPayloads = buildIntentPayloads(intents, registry);

  try {
    // Layer 2 & 3: Generate questions and answers via edge function
    const { data, error } = await supabase.functions.invoke('generate-constrained-questions', {
      body: {
        topic,
        bloom_level: bloomLevel,
        knowledge_dimension: knowledgeDimension,
        difficulty,
        count: intents.length,
        question_type: questionType,
        // FIXED: Pass full intent payloads with concepts and operations
        intents: intentPayloads,
        pipeline_mode: 'intent_driven'
      }
    });

    if (error) {
      console.error('Intent-driven generation error:', error);
      return {
        success: false,
        questions: [],
        intentsUsed: intents,
        error: error.message
      };
    }

    const questions: IntentDrivenQuestion[] = (data?.questions || []).map((q: any, idx: number) => {
      const intent = intents[idx] || intents[0];
      const payload = intentPayloads[idx] || intentPayloads[0];
      return {
        text: q.text,
        answer: q.answer || q.correct_answer || '',
        choices: q.choices,
        correct_answer: q.correct_answer,
        intent,
        difficulty,
        bloom_alignment_note: q.bloom_alignment_note,
        knowledge_alignment_note: q.knowledge_alignment_note,
        answer_type_note: q.answer_type_note,
        assigned_concept: payload.assigned_concept,
        assigned_operation: payload.assigned_operation
      };
    });

    // Mark intents as used in the registry
    intents.forEach(intent => registry.markUsed(intent));

    return {
      success: true,
      questions,
      intentsUsed: intents
    };

  } catch (err) {
    console.error('Generation failed:', err);
    return {
      success: false,
      questions: [],
      intentsUsed: intents,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

/**
 * Generate a single question with a specific intent
 */
export async function generateSingleWithIntent(
  intent: QuestionIntent,
  difficulty: string = 'Average',
  questionType: 'mcq' | 'essay' = 'mcq'
): Promise<IntentDrivenQuestion | null> {
  const registry = new IntentRegistry();
  
  const result = await generateWithIntent({
    topic: intent.topic,
    bloomLevel: intent.bloomLevel,
    knowledgeDimension: intent.knowledgeDimension,
    difficulty,
    count: 1,
    questionType,
    registry
  });

  return result.success && result.questions.length > 0 ? result.questions[0] : null;
}

/**
 * Check if generation is possible for given constraints
 */
export function canGenerate(
  registry: IntentRegistry,
  topic: string,
  bloomLevel: string,
  knowledgeDimension: KnowledgeDimension
): boolean {
  return registry.hasAvailableSlots(topic, bloomLevel, knowledgeDimension);
}

/**
 * Get remaining generation capacity for constraints
 */
export function getRemainingCapacity(
  registry: IntentRegistry,
  topic: string,
  bloomLevel: string,
  knowledgeDimension: KnowledgeDimension
): number {
  return registry.getAvailableAnswerTypes(topic, bloomLevel, knowledgeDimension).length;
}
