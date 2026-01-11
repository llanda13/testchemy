import type { BloomLevel, Difficulty } from "./classify";

export interface AIGeneratedQuestion {
  question_text: string;
  question_type: 'mcq' | 'true_false' | 'short_answer' | 'essay';
  choices?: string[];
  correct_answer: string;
  topic: string;
  bloom_level: BloomLevel;
  difficulty: Difficulty;
  points: number;
}

/**
 * Generate questions using AI (template-based fallback)
 * In production, this would call OpenAI or another LLM
 */
export async function generateQuestionsWithAI(
  topic: string,
  bloomLevel: BloomLevel,
  difficulty: Difficulty,
  count: number
): Promise<AIGeneratedQuestion[]> {
  console.log(`🤖 Generating ${count} AI questions for ${topic} at ${bloomLevel} level, ${difficulty} difficulty`);

  const questions: AIGeneratedQuestion[] = [];
  
  // Template-based generation (fallback for when OpenAI is not available)
  for (let i = 0; i < count; i++) {
    const questionType = selectQuestionType(bloomLevel);
    const question = generateTemplateQuestion(topic, bloomLevel, difficulty, questionType, i + 1);
    questions.push(question);
  }

  return questions;
}

function selectQuestionType(bloomLevel: BloomLevel): 'mcq' | 'true_false' | 'short_answer' | 'essay' {
  // Lower levels: more MCQ and True/False
  // Higher levels: more short answer and essay
  const types: Record<BloomLevel, Array<'mcq' | 'true_false' | 'short_answer' | 'essay'>> = {
    remembering: ['mcq', 'true_false', 'mcq'],
    understanding: ['mcq', 'short_answer', 'mcq'],
    applying: ['mcq', 'short_answer', 'short_answer'],
    analyzing: ['short_answer', 'essay', 'mcq'],
    evaluating: ['essay', 'short_answer', 'essay'],
    creating: ['essay', 'essay', 'short_answer']
  };

  const options = types[bloomLevel] || ['mcq'];
  return options[Math.floor(Math.random() * options.length)];
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Randomize correct answer position for MCQ
 */
function randomizeAnswerPosition(correctText: string, distractors: string[]): { choices: string[]; correctIndex: number } {
  const allOptions = [correctText, ...distractors.slice(0, 3)];
  
  // Ensure we have exactly 4 options
  while (allOptions.length < 4) {
    allOptions.push(`Alternative option ${allOptions.length + 1}`);
  }
  
  // Create indexed options to track correct answer
  const indexedOptions = allOptions.map((text, idx) => ({ text, isCorrect: idx === 0 }));
  
  // Shuffle the options
  const shuffled = shuffleArray(indexedOptions);
  
  const choices = shuffled.map(opt => opt.text);
  const correctIndex = shuffled.findIndex(opt => opt.isCorrect);
  
  return { choices, correctIndex };
}

function generateTemplateQuestion(
  topic: string,
  bloomLevel: BloomLevel,
  difficulty: Difficulty,
  questionType: 'mcq' | 'true_false' | 'short_answer' | 'essay',
  index: number
): AIGeneratedQuestion {
  const templates = getQuestionTemplates(bloomLevel, questionType);
  const template = templates[index % templates.length];
  
  let question_text = template.replace('{topic}', topic);
  let choices: string[] | undefined;
  let correct_answer: string;

  switch (questionType) {
    case 'mcq':
      // Generate substantive MCQ options based on Bloom's level
      const mcqContent = generateMCQContent(topic, bloomLevel, difficulty, index);
      
      // Randomize answer position
      const { choices: shuffledChoices, correctIndex } = randomizeAnswerPosition(
        mcqContent.correct,
        mcqContent.distractors
      );
      
      choices = shuffledChoices;
      const letters = ['A', 'B', 'C', 'D'];
      correct_answer = letters[correctIndex];
      break;
    
    case 'true_false':
      choices = ['True', 'False'];
      correct_answer = Math.random() < 0.5 ? 'True' : 'False';
      break;
    
    case 'short_answer':
      correct_answer = generateShortAnswerContent(topic, bloomLevel);
      break;
    
    case 'essay':
      correct_answer = generateEssayRubric(topic, bloomLevel);
      break;
  }

  return {
    question_text,
    question_type: questionType,
    choices,
    correct_answer,
    topic,
    bloom_level: bloomLevel,
    difficulty,
    points: getPointsForDifficulty(difficulty)
  };
}

/**
 * Generate substantive MCQ content with real options (not placeholders)
 */
function generateMCQContent(topic: string, bloomLevel: BloomLevel, difficulty: Difficulty, index: number): { correct: string; distractors: string[] } {
  // Content pools based on Bloom's level
  const contentByBloom: Record<BloomLevel, { correct: string[]; distractors: string[][] }> = {
    remembering: {
      correct: [
        `The fundamental principle that defines ${topic}`,
        `The primary characteristic of ${topic}`,
        `The essential component of ${topic}`
      ],
      distractors: [
        [`A secondary consideration in ${topic}`, `An unrelated concept to ${topic}`, `A common misconception about ${topic}`],
        [`An optional aspect of ${topic}`, `A deprecated approach in ${topic}`, `A specialized variant of ${topic}`],
        [`A theoretical model of ${topic}`, `An advanced extension of ${topic}`, `A historical predecessor of ${topic}`]
      ]
    },
    understanding: {
      correct: [
        `It ensures proper implementation and reduces errors`,
        `It provides a systematic approach to problem-solving`,
        `It establishes clear guidelines for consistent outcomes`
      ],
      distractors: [
        [`It only applies to theoretical scenarios`, `It is primarily used for documentation`, `It is optional in most implementations`],
        [`It focuses solely on performance optimization`, `It replaces the need for testing`, `It automates all manual processes`],
        [`It eliminates the need for planning`, `It is only relevant for large projects`, `It requires specialized hardware`]
      ]
    },
    applying: {
      correct: [
        `Apply the standard procedure and validate results`,
        `Use the established framework with appropriate modifications`,
        `Implement the solution following best practices`
      ],
      distractors: [
        [`Skip validation to save time`, `Use an untested alternative approach`, `Ignore standard procedures`],
        [`Implement without considering requirements`, `Focus only on speed over quality`, `Avoid documentation entirely`],
        [`Use deprecated methods for simplicity`, `Bypass security considerations`, `Ignore edge cases`]
      ]
    },
    analyzing: {
      correct: [
        `It reveals the relationship between components and their dependencies`,
        `It identifies the key factors that influence the outcome`,
        `It distinguishes between essential and optional elements`
      ],
      distractors: [
        [`It only shows surface-level patterns`, `It ignores system interactions`, `It focuses on irrelevant details`],
        [`It overlooks critical dependencies`, `It conflates cause and effect`, `It assumes uniform conditions`],
        [`It treats all factors equally`, `It ignores contextual factors`, `It oversimplifies complexity`]
      ]
    },
    evaluating: {
      correct: [
        `It provides the most balanced approach considering all constraints`,
        `It offers the best trade-off between efficiency and maintainability`,
        `It addresses both immediate needs and long-term sustainability`
      ],
      distractors: [
        [`It prioritizes speed over correctness`, `It ignores stakeholder requirements`, `It lacks scalability considerations`],
        [`It is too complex for the given context`, `It fails to address core requirements`, `It introduces unnecessary dependencies`],
        [`It requires excessive resources`, `It has limited applicability`, `It conflicts with best practices`]
      ]
    },
    creating: {
      correct: [
        `Design a modular solution that can be extended and maintained`,
        `Develop an integrated approach combining multiple methodologies`,
        `Create a comprehensive framework addressing all requirements`
      ],
      distractors: [
        [`Copy an existing solution without modification`, `Focus only on the immediate problem`, `Ignore integration requirements`],
        [`Build without a clear architecture`, `Prioritize features over stability`, `Avoid testing until completion`],
        [`Design for a single use case only`, `Ignore user feedback in design`, `Skip the planning phase`]
      ]
    }
  };

  const content = contentByBloom[bloomLevel];
  const correctIdx = index % content.correct.length;
  const distractorIdx = index % content.distractors.length;

  return {
    correct: content.correct[correctIdx],
    distractors: content.distractors[distractorIdx]
  };
}

/**
 * Generate substantive short answer content
 */
function generateShortAnswerContent(topic: string, bloomLevel: BloomLevel): string {
  const answers: Record<BloomLevel, string[]> = {
    remembering: [`Definition of ${topic}`, `Key term in ${topic}`, `Primary concept`],
    understanding: [`The main purpose is to ensure quality and consistency`, `It enables systematic approach to ${topic}`],
    applying: [`Apply the appropriate method and validate`, `Use standard procedure with verification`],
    analyzing: [`The relationship shows interdependence`, `Key factors include scope and complexity`],
    evaluating: [`The most effective approach considers all constraints`, `Optimal solution balances competing requirements`],
    creating: [`Design should incorporate modularity and extensibility`, `Develop an integrated solution`]
  };
  
  const options = answers[bloomLevel] || answers.understanding;
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * Generate essay rubric content
 */
function generateEssayRubric(topic: string, bloomLevel: BloomLevel): string {
  return `5 pts: Comprehensive analysis with clear examples and critical evaluation
4 pts: Good understanding with relevant examples
3 pts: Basic understanding with some examples
2 pts: Limited understanding with few examples
1 pt: Minimal understanding demonstrated`;
}

/**
 * Get question templates based on Bloom's level
 */
function getQuestionTemplates(bloomLevel: BloomLevel, questionType: string): string[] {
  const templates: Record<BloomLevel, string[]> = {
    remembering: [
      'What is the definition of {topic}?',
      'List the key components of {topic}.',
      'Identify the main characteristics of {topic}.'
    ],
    understanding: [
      'Explain the concept of {topic} in your own words.',
      'Describe how {topic} works.',
      'Summarize the key points about {topic}.'
    ],
    applying: [
      'How would you apply {topic} to solve this problem?',
      'Demonstrate the use of {topic} in a practical scenario.',
      'Use {topic} to analyze the following situation.'
    ],
    analyzing: [
      'Compare and contrast different aspects of {topic}.',
      'Analyze the relationship between {topic} and related concepts.',
      'What are the underlying principles of {topic}?'
    ],
    evaluating: [
      'Evaluate the effectiveness of {topic} in achieving its goals.',
      'Critique the strengths and weaknesses of {topic}.',
      'Judge the importance of {topic} in its context.'
    ],
    creating: [
      'Design a solution using {topic}.',
      'Create a new approach to {topic}.',
      'Develop a comprehensive plan involving {topic}.'
    ]
  };

  return templates[bloomLevel] || templates.remembering;
}

/**
 * Get points based on difficulty
 */
function getPointsForDifficulty(difficulty: Difficulty): number {
  const pointsMap: Record<string, number> = {
    easy: 1,
    medium: 2,
    hard: 3
  };
  return pointsMap[difficulty] || 1;
}
