// Multi-version test generator with seeded shuffling
import { Question } from './supabaseClient';

// Seeded random number generator for consistent shuffling
function mulberry32(a: number) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

function shuffleWithSeed<T>(arr: T[], seed: string): T[] {
  const rng = mulberry32(hashString(seed));
  const shuffled = [...arr];
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

export interface TestVersion {
  version_label: string;
  questions: Question[];
  answer_key: Record<number, string>;
  question_ids: string[];
}

export interface MultiVersionTest {
  title: string;
  versions: Record<string, TestVersion>;
  version_count: number;
  base_questions: Question[];
}

export function generateMultipleVersions(
  baseQuestions: Question[],
  versionCount: number,
  testTitle: string = "Generated Test"
): MultiVersionTest {
  const versions: Record<string, TestVersion> = {};
  const versionLabels = ['A', 'B', 'C', 'D', 'E', 'F'];
  
  for (let i = 0; i < Math.min(versionCount, versionLabels.length); i++) {
    const versionLabel = versionLabels[i];
    const questionSeed = `questions-${testTitle}-${versionLabel}`;
    
    // Shuffle questions for this version
    const shuffledQuestions = shuffleWithSeed(baseQuestions, questionSeed);
    
    // Shuffle choices within each question
    const questionsWithShuffledChoices = shuffledQuestions.map((question, qIndex) => {
      if (question.question_type === 'multiple-choice' && question.choices) {
        const choiceSeed = `choices-${testTitle}-${versionLabel}-${qIndex}`;
        const choiceKeys = ['A', 'B', 'C', 'D'];
        const shuffledKeys = shuffleWithSeed(choiceKeys, choiceSeed);
        
        // Create new choices object with shuffled order
        const newChoices: Record<string, string> = {};
        shuffledKeys.forEach((originalKey, newIndex) => {
          const newKey = choiceKeys[newIndex];
          newChoices[newKey] = question.choices![originalKey];
        });
        
        // Update correct answer to match new key
        const originalCorrectIndex = choiceKeys.indexOf(question.correct_answer);
        const newCorrectKey = choiceKeys[shuffledKeys.indexOf(question.correct_answer)];
        
        return {
          ...question,
          choices: newChoices,
          correct_answer: newCorrectKey
        };
      }
      
      return question;
    });
    
    // Create answer key
    const answer_key: Record<number, string> = {};
    questionsWithShuffledChoices.forEach((question, index) => {
      answer_key[index + 1] = question.correct_answer;
    });
    
    versions[versionLabel] = {
      version_label: versionLabel,
      questions: questionsWithShuffledChoices,
      answer_key,
      question_ids: questionsWithShuffledChoices.map(q => q.id!).filter(Boolean)
    };
  }
  
  return {
    title: testTitle,
    versions,
    version_count: versionCount,
    base_questions: baseQuestions
  };
}

export function generateSingleVersion(
  questions: Question[],
  versionLabel: string = 'A',
  testTitle: string = "Generated Test"
): TestVersion {
  const multiVersion = generateMultipleVersions(questions, 1, testTitle);
  return multiVersion.versions['A'];
}

// Utility to extract questions by TOS requirements
export function selectQuestionsByTOS(
  allQuestions: Question[],
  requirements: Array<{
    topic: string;
    bloom_level: string;
    difficulty: string;
    count: number;
  }>
): Question[] {
  const selectedQuestions: Question[] = [];
  
  for (const req of requirements) {
    // Filter questions matching requirements
    const matchingQuestions = allQuestions.filter(q => 
      q.topic === req.topic &&
      q.bloom_level === req.bloom_level &&
      q.difficulty === req.difficulty &&
      q.approved === true &&
      !selectedQuestions.find(selected => selected.id === q.id) // Avoid duplicates
    );
    
    // Select required count (or all available if less than required)
    const questionsToAdd = matchingQuestions.slice(0, req.count);
    selectedQuestions.push(...questionsToAdd);
    
    // If we don't have enough questions, try to fill with similar difficulty from same topic
    if (questionsToAdd.length < req.count) {
      const shortfall = req.count - questionsToAdd.length;
      const similarQuestions = allQuestions.filter(q =>
        q.topic === req.topic &&
        q.bloom_level === req.bloom_level &&
        q.approved === true &&
        !selectedQuestions.find(selected => selected.id === q.id)
      );
      
      const fillQuestions = similarQuestions.slice(0, shortfall);
      selectedQuestions.push(...fillQuestions);
    }
  }
  
  return selectedQuestions;
}

// Calculate test statistics
export function calculateTestStats(questions: Question[]) {
  const stats = {
    total_questions: questions.length,
    by_bloom_level: {} as Record<string, number>,
    by_difficulty: {} as Record<string, number>,
    by_topic: {} as Record<string, number>,
    by_knowledge_dimension: {} as Record<string, number>
  };
  
  questions.forEach(q => {
    // Count by Bloom level
    stats.by_bloom_level[q.bloom_level] = (stats.by_bloom_level[q.bloom_level] || 0) + 1;
    
    // Count by difficulty
    stats.by_difficulty[q.difficulty] = (stats.by_difficulty[q.difficulty] || 0) + 1;
    
    // Count by topic
    stats.by_topic[q.topic] = (stats.by_topic[q.topic] || 0) + 1;
    
    // Count by knowledge dimension
    stats.by_knowledge_dimension[q.knowledge_dimension] = (stats.by_knowledge_dimension[q.knowledge_dimension] || 0) + 1;
  });
  
  return stats;
}

// Validate test requirements against available questions
export function validateTestRequirements(
  allQuestions: Question[],
  requirements: Array<{
    topic: string;
    bloom_level: string;
    difficulty: string;
    count: number;
  }>
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  for (const req of requirements) {
    const matchingQuestions = allQuestions.filter(q =>
      q.topic === req.topic &&
      q.bloom_level === req.bloom_level &&
      q.difficulty === req.difficulty &&
      q.approved === true
    );
    
    if (matchingQuestions.length < req.count) {
      issues.push(
        `Insufficient questions for ${req.topic} - ${req.bloom_level} - ${req.difficulty}: ` +
        `need ${req.count}, have ${matchingQuestions.length}`
      );
    }
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}