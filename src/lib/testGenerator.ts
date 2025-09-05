import { Questions, Tests, ActivityLog } from '@/services/db';
import { generateAIQuestion, generateAIQuestionsForNeed, analyzeTopicCoverage } from './classify';

export type TestNeed = {
  topic: string;
  bloom_level: string;
  difficulty: string;
  count: number;
};

export type TestConfiguration = {
  title: string;
  subject: string;
  course?: string;
  year_section?: string;
  exam_period?: string;
  school_year?: string;
  instructions: string;
  time_limit?: number;
  points_per_question: number;
  shuffle_questions: boolean;
  shuffle_choices: boolean;
  number_of_versions: number;
  tos_id?: string;
};

export type TestGenerationResult = {
  testId: string;
  versions: TestVersion[];
  generatedQuestions: number;
  warnings: string[];
};

export type TestVersion = {
  version_label: string;
  questions: any[];
  answer_key: Record<string, string>;
  total_points: number;
};

/**
 * Build test needs from TOS matrix
 */
export function buildNeedsFromTOS(tosMatrix: any): TestNeed[] {
  const needs: TestNeed[] = [];
  const { distribution } = tosMatrix;

  Object.entries(distribution).forEach(([topic, bloomLevels]: [string, any]) => {
    Object.entries(bloomLevels).forEach(([bloomLevel, items]: [string, any]) => {
      const count = Array.isArray(items) ? items.length : 0;
      if (count > 0) {
        // Map Bloom's level to difficulty
        const difficulty = ['remembering', 'understanding'].includes(bloomLevel) ? 'easy'
                         : ['applying', 'analyzing'].includes(bloomLevel) ? 'average' : 'difficult';
        
        needs.push({
          topic,
          bloom_level: bloomLevel,
          difficulty,
          count
        });
      }
    });
  });

  return needs;
}

/**
 * Enhanced needs building with better distribution
 */
export function buildEnhancedNeedsFromTOS(tosMatrix: any): TestNeed[] {
  const needs: TestNeed[] = [];
  const { formData, distribution } = tosMatrix;
  
  // Calculate total hours for percentage-based distribution
  const totalHours = formData.topics.reduce((sum: number, topic: any) => sum + topic.hours, 0);
  
  formData.topics.forEach((topicData: any) => {
    const topicPercentage = topicData.hours / totalHours;
    const topicItems = Math.round(formData.totalItems * topicPercentage);
    
    // Distribute across Bloom's levels (standard distribution)
    const bloomDistribution = {
      remembering: Math.round(topicItems * 0.15),
      understanding: Math.round(topicItems * 0.15),
      applying: Math.round(topicItems * 0.20),
      analyzing: Math.round(topicItems * 0.20),
      evaluating: Math.round(topicItems * 0.15),
      creating: Math.round(topicItems * 0.15)
    };
    
    Object.entries(bloomDistribution).forEach(([bloomLevel, count]) => {
      if (count > 0) {
        const difficulty = ['remembering', 'understanding'].includes(bloomLevel) ? 'easy'
                         : ['applying', 'analyzing'].includes(bloomLevel) ? 'average' : 'difficult';
        
        needs.push({
          topic: topicData.topic,
          bloom_level: bloomLevel,
          difficulty,
          count
        });
      }
    });
  });
  
  return needs;
}

/**
 * Fetch questions for specific needs, generate AI questions if insufficient
 */
export async function fetchQuestionsForNeeds(needs: TestNeed[], approvedOnly: boolean = true): Promise<any[]> {
  const selectedQuestions: any[] = [];
  const generatedQuestions: any[] = [];
  const warnings: string[] = [];

  for (const need of needs) {
    // Try to fetch existing questions
    const existingQuestions = await Questions.search({
      topic: need.topic,
      bloom_level: need.bloom_level,
      difficulty: need.difficulty,
      approved: approvedOnly
    });

    const available = existingQuestions || [];
    const needed = need.count;
    const shortage = Math.max(0, needed - available.length);

    // Add available questions
    selectedQuestions.push(...available.slice(0, needed));

    // Generate AI questions for shortage
    if (shortage > 0) {
      const aiQuestions = generateAIQuestionsForNeed(
        need.topic, 
        need.bloom_level, 
        need.difficulty, 
        shortage
      );
      generatedQuestions.push(...aiQuestions);
      warnings.push(`Generated ${shortage} AI questions for ${need.topic} (${need.bloom_level})`);
    }
  }

  // Insert generated questions to database
  if (generatedQuestions.length > 0) {
    const inserted = await Questions.insertMany(generatedQuestions);
    selectedQuestions.push(...inserted);
    
    // Log activity
    await ActivityLog.log('generate_questions', 'bulk', null, {
      count: generatedQuestions.length,
      reason: 'insufficient_bank'
    });
  }

  return { questions: selectedQuestions, warnings };
}

/**
 * Shuffle array using Fisher-Yates algorithm
 */
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Shuffle MCQ choices and update correct answer
 */
export function shuffleChoices(question: any): { question: any; mapping: Record<string, string> } {
  if (question.question_type !== 'mcq' && question.question_type !== 'multiple_choice' || !question.choices) {
    return { question, mapping: {} };
  }

  const choiceEntries = Object.entries(question.choices);
  const shuffledEntries = shuffleArray(choiceEntries);
  
  // Create new choice mapping
  const newChoices: Record<string, string> = {};
  const choiceKeys = ['A', 'B', 'C', 'D', 'E', 'F'];
  const mapping: Record<string, string> = {};
  
  shuffledEntries.forEach(([originalKey, value], index) => {
    if (index < choiceKeys.length) {
      const newKey = choiceKeys[index];
      newChoices[newKey] = value as string;
      mapping[newKey] = originalKey; // Track original position
    }
  });

  // Find new position of correct answer
  const originalCorrectValue = question.choices[question.correct_answer];
  const newCorrectKey = shuffledEntries.findIndex(([, value]) => value === originalCorrectValue);
  const newCorrectAnswer = newCorrectKey !== -1 ? choiceKeys[newCorrectKey] : question.correct_answer;

  return {
    question: {
      ...question,
      choices: newChoices,
      correct_answer: newCorrectAnswer
    },
    mapping
  };
}

/**
 * Generate multiple test versions with shuffling
 */
export async function generateTestVersions(
  config: TestConfiguration,
  questions: any[]
): Promise<TestVersion[]> {
  const versions = [];
  const versionLabels = ['A', 'B', 'C', 'D', 'E'];

  for (let i = 0; i < config.number_of_versions; i++) {
    let versionQuestions = [...questions];

    // Shuffle questions if enabled
    if (config.shuffle_questions) {
      versionQuestions = shuffleArray(versionQuestions);
    }

    // Shuffle answer choices if enabled
    if (config.shuffle_choices) {
      versionQuestions = versionQuestions.map(q => {
        const { question } = shuffleChoices(q);
        return question;
      });
    }

    // Create answer key
    const answerKey: Record<string, string> = {};
    versionQuestions.forEach((question, index) => {
      const questionNumber = (index + 1).toString();
      if (question.correct_answer) {
        answerKey[questionNumber] = question.correct_answer;
      }
    });

    versions.push({
      version_label: versionLabels[i],
      questions: versionQuestions,
      answer_key: answerKey,
      total_points: questions.length * config.points_per_question
    });
  }

  return versions;
}

/**
 * Save test with multiple versions to database
 */
export async function saveTestWithVersions(
  config: TestConfiguration,
  versions: TestVersion[]
): Promise<TestGenerationResult> {
  // Create test metadata
  const testMetadata = await Tests.create({
    title: config.title,
    subject: config.subject,
    course: config.course,
    year_section: config.year_section,
    exam_period: config.exam_period,
    school_year: config.school_year,
    instructions: config.instructions,
    time_limit: config.time_limit,
    points_per_question: config.points_per_question,
    total_questions: versions[0]?.questions.length || 0,
    shuffle_questions: config.shuffle_questions,
    shuffle_choices: config.shuffle_choices,
    number_of_versions: config.number_of_versions
  });

  // Also create generated_tests entry if from TOS
  let generatedTest = null;
  if (config.tos_id) {
    generatedTest = await Tests.createGenerated(config.tos_id, config.title, {
      config,
      versions: versions.length,
      total_questions: versions[0]?.questions.length || 0
    });
  }

  // Save each version
  for (const version of versions) {
    await Tests.addVersion(
      testMetadata.id,
      version.version_label,
      version.questions,
      version.answer_key,
      version.total_points
    );
  }

  // Log activity
  await ActivityLog.log('generate_test', 'test_metadata', testMetadata.id, {
    title: config.title,
    versions: config.number_of_versions,
    questions: versions[0]?.questions.length || 0
  });

  const generatedQuestions = versions[0]?.questions.filter(q => q.created_by === 'ai').length || 0;
  
  return {
    testId: testMetadata.id,
    versions,
    generatedQuestions,
    warnings: generatedQuestions > 0 ? [`Generated ${generatedQuestions} AI questions due to insufficient question bank`] : []
  };
}

/**
 * Validate test configuration
 */
export function validateTestConfig(config: TestConfiguration, questions: any[]): string[] {
  const errors: string[] = [];

  if (!config.title.trim()) {
    errors.push('Test title is required');
  }

  if (!config.subject.trim()) {
    errors.push('Subject is required');
  }

  if (questions.length === 0) {
    errors.push('At least one question must be selected');
  }

  if (config.number_of_versions < 1 || config.number_of_versions > 5) {
    errors.push('Number of versions must be between 1 and 5');
  }

  if (config.points_per_question < 1) {
    errors.push('Points per question must be at least 1');
  }

  if (config.time_limit && config.time_limit < 10) {
    errors.push('Time limit must be at least 10 minutes');
  }

  return errors;
}

/**
 * Check if questions maintain balance across versions
 */
export function validateVersionBalance(
  questions: any[],
  config: TestConfiguration
): { isBalanced: boolean; warnings: string[] } {
  const warnings: string[] = [];
  
  // Check topic distribution
  const topicCounts = questions.reduce((acc, q) => {
    acc[q.topic] = (acc[q.topic] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Check difficulty distribution
  const difficultyCounts = questions.reduce((acc, q) => {
    acc[q.difficulty] = (acc[q.difficulty] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Check Bloom's level distribution
  const bloomCounts = questions.reduce((acc, q) => {
    acc[q.bloom_level] = (acc[q.bloom_level] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Warn if any category has very few questions
  Object.entries(topicCounts).forEach(([topic, count]) => {
    if (count < 2 && config.number_of_versions > 1) {
      warnings.push(`Topic "${topic}" has only ${count} question(s). Consider adding more for better balance.`);
    }
  });

  // Check for missing difficulty levels
  const expectedDifficulties = ['easy', 'average', 'difficult'];
  expectedDifficulties.forEach(difficulty => {
    if (!difficultyCounts[difficulty]) {
      warnings.push(`No ${difficulty} questions found. Consider adding some for better balance.`);
    }
  });

  // Check for missing Bloom's levels
  const expectedBloomLevels = ['remembering', 'understanding', 'applying', 'analyzing', 'evaluating', 'creating'];
  const missingBloomLevels = expectedBloomLevels.filter(level => !bloomCounts[level]);
  if (missingBloomLevels.length > 0) {
    warnings.push(`Missing Bloom's levels: ${missingBloomLevels.join(', ')}`);
  }

  const totalQuestions = questions.length;
  if (totalQuestions < config.number_of_versions * 5) {
    warnings.push(`With ${totalQuestions} questions and ${config.number_of_versions} versions, each version will have limited variety.`);
  }

  return {
    isBalanced: warnings.length === 0,
    warnings
  };
}

/**
 * Generate test from TOS matrix
 */
export async function generateTestFromTOS(
  tosMatrix: any,
  config: TestConfiguration
): Promise<TestGenerationResult> {
  // Build needs from TOS
  const needs = buildEnhancedNeedsFromTOS(tosMatrix);
  
  // Fetch questions for needs
  const { questions, warnings: fetchWarnings } = await fetchQuestionsForNeeds(needs, true);
  
  // Validate configuration
  const configErrors = validateTestConfig(config, questions);
  if (configErrors.length > 0) {
    throw new Error(`Configuration errors: ${configErrors.join(', ')}`);
  }
  
  // Generate versions
  const versions = await generateTestVersions(config, questions);
  
  // Save to database
  const result = await saveTestWithVersions(config, versions);
  
  return {
    ...result,
    warnings: [...result.warnings, ...fetchWarnings]
  };
}

/**
 * Analyze question bank sufficiency for TOS
 */
export async function analyzeTOSSufficiency(tosMatrix: any): Promise<{
  sufficient: boolean;
  analysis: Record<string, any>;
  recommendations: string[];
}> {
  const needs = buildEnhancedNeedsFromTOS(tosMatrix);
  const analysis: Record<string, any> = {};
  const recommendations: string[] = [];
  let totalShortage = 0;
  
  for (const need of needs) {
    const existingQuestions = await Questions.search({
      topic: need.topic,
      bloom_level: need.bloom_level,
      difficulty: need.difficulty,
      approved: true
    });
    
    const available = existingQuestions?.length || 0;
    const shortage = Math.max(0, need.count - available);
    totalShortage += shortage;
    
    analysis[`${need.topic}-${need.bloom_level}`] = {
      needed: need.count,
      available,
      shortage,
      sufficient: shortage === 0
    };
    
    if (shortage > 0) {
      recommendations.push(
        `Add ${shortage} more ${need.difficulty} ${need.bloom_level} questions for "${need.topic}"`
      );
    }
  }
  
  return {
    sufficient: totalShortage === 0,
    analysis,
    recommendations
  };
}