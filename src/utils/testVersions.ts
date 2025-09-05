import seedrandom from 'seedrandom';

export interface Question {
  id: string;
  question_text: string;
  question_type: string;
  choices?: Record<string, string>;
  correct_answer?: string;
  topic: string;
  bloom_level: string;
  difficulty: string;
}

export interface TestVersion {
  label: string;
  items: Array<{
    id: string;
    order: number;
    question_id: string;
    question_text: string;
    question_type: string;
    choices?: Record<string, string>;
    correct_answer?: string;
    topic: string;
    bloom_level: string;
    difficulty: string;
  }>;
}

export interface AnswerKey {
  label: string;
  keys: Array<{ number: number; answer: string }>;
}

export interface VersionGenerationOptions {
  shuffle_questions: boolean;
  shuffle_choices: boolean;
  num_versions: number;
  seed?: string;
}

// Deterministic shuffle using seeded random
export function shuffle<T>(array: T[], seed: string): T[] {
  const rng = seedrandom(seed);
  const shuffled = [...array];
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

// Shuffle MCQ choices and update correct answer mapping
export function shuffleChoices(
  choices: Record<string, string>, 
  correctAnswer: string, 
  seed: string
): { choices: Record<string, string>; correct: string } {
  const entries = Object.entries(choices);
  const shuffled = shuffle(entries, seed);
  
  const newChoices: Record<string, string> = {};
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  let newCorrect = 'A';
  
  shuffled.forEach(([originalKey, text], idx) => {
    const newKey = labels[idx];
    newChoices[newKey] = text;
    
    // Track where the original correct answer moved to
    if (originalKey === correctAnswer) {
      newCorrect = newKey;
    }
  });
  
  return { choices: newChoices, correct: newCorrect };
}

// Generate multiple test versions with deterministic shuffling
export function generateVersions(
  baseQuestions: Question[],
  options: VersionGenerationOptions
): { versions: TestVersion[]; answerKeys: AnswerKey[] } {
  const { shuffle_questions, shuffle_choices, num_versions, seed = 'default' } = options;
  const versions: TestVersion[] = [];
  const answerKeys: AnswerKey[] = [];
  const labels = ['A', 'B', 'C', 'D', 'E'];

  for (let i = 0; i < num_versions; i++) {
    const versionLabel = labels[i];
    const versionSeed = `${seed}-${versionLabel}`;
    
    // Shuffle question order if enabled
    let orderedQuestions = shuffle_questions 
      ? shuffle(baseQuestions, `${versionSeed}-order`)
      : [...baseQuestions];
    
    // Process each question
    const versionItems = orderedQuestions.map((question, index) => {
      let processedQuestion = { ...question };
      
      // Shuffle choices if enabled and question is MCQ
      if (shuffle_choices && question.question_type === 'mcq' && question.choices && question.correct_answer) {
        const { choices, correct } = shuffleChoices(
          question.choices,
          question.correct_answer,
          `${versionSeed}-q${index}`
        );
        processedQuestion = {
          ...processedQuestion,
          choices,
          correct_answer: correct
        };
      }
      
      return {
        id: `${versionLabel}-${index + 1}`,
        order: index + 1,
        question_id: question.id,
        question_text: processedQuestion.question_text,
        question_type: processedQuestion.question_type,
        choices: processedQuestion.choices,
        correct_answer: processedQuestion.correct_answer,
        topic: processedQuestion.topic,
        bloom_level: processedQuestion.bloom_level,
        difficulty: processedQuestion.difficulty
      };
    });

    versions.push({
      label: versionLabel,
      items: versionItems
    });

    // Generate answer key for this version
    const answerKey: AnswerKey = {
      label: versionLabel,
      keys: versionItems.map(item => ({
        number: item.order,
        answer: item.correct_answer || 'N/A'
      }))
    };
    
    answerKeys.push(answerKey);
  }

  return { versions, answerKeys };
}

// Analyze version differences for comparison
export function analyzeVersionDifferences(versions: TestVersion[]): {
  questionOrderChanges: Record<string, number>;
  choiceOrderChanges: Record<string, number>;
  totalDifferences: number;
} {
  if (versions.length < 2) {
    return { questionOrderChanges: {}, choiceOrderChanges: {}, totalDifferences: 0 };
  }

  const baseVersion = versions[0];
  const analysis = {
    questionOrderChanges: {} as Record<string, number>,
    choiceOrderChanges: {} as Record<string, number>,
    totalDifferences: 0
  };

  for (let i = 1; i < versions.length; i++) {
    const version = versions[i];
    let orderChanges = 0;
    let choiceChanges = 0;

    // Compare question order
    version.items.forEach((item, index) => {
      const baseItem = baseVersion.items[index];
      if (baseItem && item.question_id !== baseItem.question_id) {
        orderChanges++;
      }
      
      // Compare choice order for MCQ questions
      if (item.question_type === 'mcq' && item.choices && baseItem?.choices) {
        const itemChoices = Object.values(item.choices);
        const baseChoices = Object.values(baseItem.choices);
        
        if (JSON.stringify(itemChoices) !== JSON.stringify(baseChoices)) {
          choiceChanges++;
        }
      }
    });

    analysis.questionOrderChanges[version.label] = orderChanges;
    analysis.choiceOrderChanges[version.label] = choiceChanges;
    analysis.totalDifferences += orderChanges + choiceChanges;
  }

  return analysis;
}

// Validate version balance (ensure fair distribution)
export function validateVersionBalance(
  versions: TestVersion[]
): { isBalanced: boolean; warnings: string[] } {
  const warnings: string[] = [];
  
  if (versions.length === 0) {
    return { isBalanced: false, warnings: ['No versions to validate'] };
  }

  // Check if all versions have the same number of questions
  const questionCounts = versions.map(v => v.items.length);
  const uniqueCounts = [...new Set(questionCounts)];
  
  if (uniqueCounts.length > 1) {
    warnings.push(`Versions have different question counts: ${questionCounts.join(', ')}`);
  }

  // Check topic distribution across versions
  const topicDistributions = versions.map(version => {
    const topics: Record<string, number> = {};
    version.items.forEach(item => {
      topics[item.topic] = (topics[item.topic] || 0) + 1;
    });
    return topics;
  });

  // Compare topic distributions
  const allTopics = [...new Set(versions.flatMap(v => v.items.map(i => i.topic)))];
  
  for (const topic of allTopics) {
    const counts = topicDistributions.map(dist => dist[topic] || 0);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    
    if (max - min > 1) {
      warnings.push(`Topic "${topic}" has uneven distribution across versions: ${counts.join(', ')}`);
    }
  }

  // Check difficulty distribution
  const difficultyDistributions = versions.map(version => {
    const difficulties: Record<string, number> = {};
    version.items.forEach(item => {
      difficulties[item.difficulty] = (difficulties[item.difficulty] || 0) + 1;
    });
    return difficulties;
  });

  const allDifficulties = ['easy', 'average', 'difficult'];
  
  for (const difficulty of allDifficulties) {
    const counts = difficultyDistributions.map(dist => dist[difficulty] || 0);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    
    if (max - min > 2) {
      warnings.push(`Difficulty "${difficulty}" has significant imbalance across versions: ${counts.join(', ')}`);
    }
  }

  return {
    isBalanced: warnings.length === 0,
    warnings
  };
}

// Generate test configuration from TOS matrix
export function buildTestConfigFromTOS(tosMatrix: any): GenerationInput {
  const distributions = [];
  
  for (const [topic, bloomData] of Object.entries(tosMatrix.matrix)) {
    const counts = {
      remembering: (bloomData as any).remembering?.count || 0,
      understanding: (bloomData as any).understanding?.count || 0,
      applying: (bloomData as any).applying?.count || 0,
      analyzing: (bloomData as any).analyzing?.count || 0,
      evaluating: (bloomData as any).evaluating?.count || 0,
      creating: (bloomData as any).creating?.count || 0,
      difficulty: {
        easy: Math.round(((bloomData as any).remembering?.count || 0) + ((bloomData as any).understanding?.count || 0)),
        average: Math.round(((bloomData as any).applying?.count || 0) + ((bloomData as any).analyzing?.count || 0)),
        difficult: Math.round(((bloomData as any).evaluating?.count || 0) + ((bloomData as any).creating?.count || 0))
      }
    };
    
    distributions.push({ topic, counts });
  }
  
  return {
    tos_id: tosMatrix.id,
    total_items: tosMatrix.total_items,
    distributions,
    allow_unapproved: false,
    prefer_existing: true
  };
}