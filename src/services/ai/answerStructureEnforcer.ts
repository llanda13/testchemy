/**
 * Answer Structure Enforcer - Prevents Redundancy by Design
 * 
 * This module enforces that GPT never chooses structure - the system does.
 * Each answer_type has explicit structural requirements that must be met.
 */

import type { AnswerType, KnowledgeDimension } from '@/types/knowledge';

/**
 * Bloom levels that FORBID generic listing answers
 */
export const HIGHER_ORDER_BLOOMS = ['Analyzing', 'Evaluating', 'Creating'] as const;

/**
 * Forbidden patterns for higher-order Bloom levels
 * If answer matches these, it must be regenerated
 */
export const FORBIDDEN_LISTING_PATTERNS = [
  /\b(include|includes)\b/i,
  /\bsuch as\b/i,
  /\bfactors\s+(are|include)\b/i,
  /\bkey\s+(factors|elements|components)\s+(are|include)\b/i,
  /\bthe\s+(main|key|primary)\s+\w+\s+(are|include)\b/i,
  /\bthese\s+(are|include)\b/i,
];

/**
 * Verb to Answer Type Mapping
 * Each question verb MUST map to exactly one answer type
 */
export const VERB_TO_ANSWER_TYPE: Record<string, { answerType: AnswerType; bloom: string }> = {
  // Remembering
  'define': { answerType: 'definition', bloom: 'Remembering' },
  'list': { answerType: 'definition', bloom: 'Remembering' },
  'identify': { answerType: 'definition', bloom: 'Remembering' },
  'name': { answerType: 'definition', bloom: 'Remembering' },
  'state': { answerType: 'definition', bloom: 'Remembering' },
  'recall': { answerType: 'definition', bloom: 'Remembering' },
  
  // Understanding
  'explain': { answerType: 'explanation', bloom: 'Understanding' },
  'describe': { answerType: 'explanation', bloom: 'Understanding' },
  'summarize': { answerType: 'explanation', bloom: 'Understanding' },
  'interpret': { answerType: 'explanation', bloom: 'Understanding' },
  'paraphrase': { answerType: 'explanation', bloom: 'Understanding' },
  
  // Applying
  'apply': { answerType: 'application', bloom: 'Applying' },
  'use': { answerType: 'application', bloom: 'Applying' },
  'implement': { answerType: 'procedure', bloom: 'Applying' },
  'solve': { answerType: 'application', bloom: 'Applying' },
  'demonstrate': { answerType: 'procedure', bloom: 'Applying' },
  'execute': { answerType: 'procedure', bloom: 'Applying' },
  
  // Analyzing
  'compare': { answerType: 'comparison', bloom: 'Analyzing' },
  'contrast': { answerType: 'comparison', bloom: 'Analyzing' },
  'differentiate': { answerType: 'analysis', bloom: 'Analyzing' },
  'distinguish': { answerType: 'analysis', bloom: 'Analyzing' },
  'analyze': { answerType: 'analysis', bloom: 'Analyzing' },
  'examine': { answerType: 'analysis', bloom: 'Analyzing' },
  'categorize': { answerType: 'analysis', bloom: 'Analyzing' },
  'deconstruct': { answerType: 'analysis', bloom: 'Analyzing' },
  
  // Evaluating
  'evaluate': { answerType: 'evaluation', bloom: 'Evaluating' },
  'assess': { answerType: 'evaluation', bloom: 'Evaluating' },
  'justify': { answerType: 'justification', bloom: 'Evaluating' },
  'critique': { answerType: 'evaluation', bloom: 'Evaluating' },
  'defend': { answerType: 'justification', bloom: 'Evaluating' },
  'argue': { answerType: 'justification', bloom: 'Evaluating' },
  'judge': { answerType: 'evaluation', bloom: 'Evaluating' },
  
  // Creating
  'design': { answerType: 'design', bloom: 'Creating' },
  'create': { answerType: 'construction', bloom: 'Creating' },
  'construct': { answerType: 'construction', bloom: 'Creating' },
  'compose': { answerType: 'construction', bloom: 'Creating' },
  'formulate': { answerType: 'design', bloom: 'Creating' },
  'generate': { answerType: 'construction', bloom: 'Creating' },
  'develop': { answerType: 'design', bloom: 'Creating' },
  'plan': { answerType: 'design', bloom: 'Creating' },
};

/**
 * Explicit Answer Structure Prompts
 * These tell GPT exactly HOW to structure each answer type
 */
export const ANSWER_STRUCTURE_PROMPTS: Record<AnswerType, {
  requirement: string;
  forbiddenPatterns: string[];
  structuralRule: string;
}> = {
  'definition': {
    requirement: 'State what something IS - terminology, facts, specific details.',
    forbiddenPatterns: [],
    structuralRule: 'Direct statement of meaning or identification. May use listing.',
  },
  'explanation': {
    requirement: 'Describe HOW or WHY something works, occurs, or is connected.',
    forbiddenPatterns: ['include', 'such as'],
    structuralRule: 'Must show cause-effect or mechanism. Cannot merely enumerate.',
  },
  'comparison': {
    requirement: 'Explicitly compare at least TWO elements. State BOTH similarities AND differences.',
    forbiddenPatterns: ['include', 'such as', 'factors'],
    structuralRule: 'Must mention Element A vs Element B. Cannot list features of only one.',
  },
  'procedure': {
    requirement: 'Outline ordered STEPS or PROCESSES to accomplish something.',
    forbiddenPatterns: ['include', 'such as'],
    structuralRule: 'Must be sequential (Step 1, Step 2...). Cannot be unordered list.',
  },
  'application': {
    requirement: 'USE knowledge to solve a new problem or address a specific scenario.',
    forbiddenPatterns: ['include', 'such as', 'factors are'],
    structuralRule: 'Must reference the specific scenario. Cannot be abstract.',
  },
  'evaluation': {
    requirement: 'Make a JUDGMENT based on criteria. State whether something is effective, valid, or optimal.',
    forbiddenPatterns: ['include', 'such as', 'factors'],
    structuralRule: 'Must contain a verdict (better/worse, effective/ineffective). Cannot merely describe.',
  },
  'justification': {
    requirement: 'Provide REASONS and EVIDENCE for a position, decision, or approach.',
    forbiddenPatterns: ['include', 'such as'],
    structuralRule: 'Must contain "because", "therefore", "this works because". Cannot merely list points.',
  },
  'analysis': {
    requirement: 'BREAK DOWN information into components and explain their RELATIONSHIPS.',
    forbiddenPatterns: ['include', 'such as', 'key factors'],
    structuralRule: 'Must identify parts AND how they interact. Cannot list parts without relationships.',
  },
  'design': {
    requirement: 'CREATE a plan, blueprint, or specification for something new.',
    forbiddenPatterns: ['include', 'such as'],
    structuralRule: 'Must have structure (sections, components) and purpose. Cannot be abstract description.',
  },
  'construction': {
    requirement: 'BUILD or PRODUCE something original and concrete.',
    forbiddenPatterns: ['include'],
    structuralRule: 'Must be a tangible output (example, prototype, solution). Cannot be theoretical.',
  },
};

/**
 * FIX #4: Structural Rejection Rule
 * Returns true if answer violates structural constraints for its type
 */
export function shouldRejectAnswer(
  answerType: AnswerType,
  answer: string,
  bloomLevel: string
): { reject: boolean; reason?: string } {
  // Skip rejection for definition type - listing is allowed
  if (answerType === 'definition') {
    return { reject: false };
  }
  
  // Check if bloom level forbids generic listing
  const isHigherOrder = HIGHER_ORDER_BLOOMS.includes(bloomLevel as any);
  
  if (isHigherOrder) {
    // Check for forbidden listing patterns
    for (const pattern of FORBIDDEN_LISTING_PATTERNS) {
      if (pattern.test(answer)) {
        return {
          reject: true,
          reason: `Answer uses forbidden listing pattern for ${bloomLevel} level: "${pattern.source}"`
        };
      }
    }
  }
  
  // Check answer-type-specific forbidden patterns
  const structure = ANSWER_STRUCTURE_PROMPTS[answerType];
  if (structure) {
    for (const forbidden of structure.forbiddenPatterns) {
      if (answer.toLowerCase().includes(forbidden.toLowerCase())) {
        return {
          reject: true,
          reason: `Answer uses pattern "${forbidden}" which is forbidden for ${answerType} type`
        };
      }
    }
  }
  
  return { reject: false };
}

/**
 * Detect answer type from question text based on verb
 */
export function detectAnswerTypeFromQuestion(questionText: string): AnswerType | null {
  const lowerText = questionText.toLowerCase();
  
  // Find the first matching verb
  for (const [verb, mapping] of Object.entries(VERB_TO_ANSWER_TYPE)) {
    // Check for verb at word boundary
    const verbPattern = new RegExp(`\\b${verb}\\b`, 'i');
    if (verbPattern.test(lowerText)) {
      return mapping.answerType;
    }
  }
  
  return null;
}

/**
 * Get required answer type for a Bloom level and question verb
 */
export function getRequiredAnswerType(
  questionText: string,
  bloomLevel: string,
  knowledgeDimension: KnowledgeDimension
): AnswerType {
  // First, try to detect from question verb
  const detectedType = detectAnswerTypeFromQuestion(questionText);
  if (detectedType) {
    return detectedType;
  }
  
  // Fallback based on Bloom level
  const bloomDefaults: Record<string, AnswerType> = {
    'Remembering': 'definition',
    'Understanding': 'explanation',
    'Applying': 'application',
    'Analyzing': 'analysis',
    'Evaluating': 'evaluation',
    'Creating': 'design',
  };
  
  return bloomDefaults[bloomLevel] || 'explanation';
}

/**
 * Build the answer constraint prompt for a specific answer type
 */
export function buildAnswerConstraintPrompt(answerType: AnswerType): string {
  const structure = ANSWER_STRUCTURE_PROMPTS[answerType];
  
  return `
=== ANSWER STRUCTURE CONSTRAINT: ${answerType.toUpperCase()} ===

REQUIREMENT: ${structure.requirement}

STRUCTURAL RULE: ${structure.structuralRule}

${structure.forbiddenPatterns.length > 0 ? `
FORBIDDEN (Will cause rejection):
${structure.forbiddenPatterns.map(p => `- Do NOT use "${p}"`).join('\n')}
` : ''}

You are NOT allowed to answer using:
- Generic enumeration ("Key factors include...")
- "such as" constructions
- Simple listing of factors without ${answerType === 'comparison' ? 'explicit comparison' : answerType === 'analysis' ? 'relationship explanation' : 'structure-specific reasoning'}

If you violate these rules, the answer WILL BE REJECTED and regenerated.
`;
}

/**
 * Validate that a question has a valid answer_type assignment
 */
export function validateAnswerTypeAssignment(
  questionText: string,
  assignedAnswerType: AnswerType,
  bloomLevel: string
): { valid: boolean; suggestion?: AnswerType; reason?: string } {
  const detectedType = detectAnswerTypeFromQuestion(questionText);
  
  // If we can detect a type from the verb, it should match
  if (detectedType && detectedType !== assignedAnswerType) {
    return {
      valid: false,
      suggestion: detectedType,
      reason: `Question verb suggests "${detectedType}" but assigned "${assignedAnswerType}"`
    };
  }
  
  // Check if answer type is appropriate for Bloom level
  const appropriateTypes: Record<string, AnswerType[]> = {
    'Remembering': ['definition'],
    'Understanding': ['definition', 'explanation'],
    'Applying': ['application', 'procedure'],
    'Analyzing': ['comparison', 'analysis'],
    'Evaluating': ['evaluation', 'justification'],
    'Creating': ['design', 'construction'],
  };
  
  const allowed = appropriateTypes[bloomLevel];
  if (allowed && !allowed.includes(assignedAnswerType)) {
    return {
      valid: false,
      suggestion: allowed[0],
      reason: `Answer type "${assignedAnswerType}" is not appropriate for ${bloomLevel} level`
    };
  }
  
  return { valid: true };
}
