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
      choices = [
        `Correct answer about ${topic}`,
        `Incorrect answer A`,
        `Incorrect answer B`,
        `Incorrect answer C`
      ];
      // Shuffle choices
      choices = shuffleArray(choices);
      correct_answer = 'A'; // Simplified - in real implementation, track correct position
      break;
    
    case 'true_false':
      choices = ['True', 'False'];
      correct_answer = 'True';
      break;
    
    case 'short_answer':
      correct_answer = `[Expected answer related to ${topic}]`;
      break;
    
    case 'essay':
      correct_answer = `[Rubric for evaluating essay on ${topic}]`;
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

function getPointsForDifficulty(difficulty: Difficulty): number {
  const pointsMap: Record<string, number> = {
    easy: 1,
    medium: 2,
    hard: 3
  };
  return pointsMap[difficulty] || 1;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
