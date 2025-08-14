// AI-powered question classification system
export interface ClassificationResult {
  bloom_level: string;
  difficulty: string;
  knowledge_dimension: string;
  confidence_score: number;
}

// Bloom's taxonomy verb mapping
const VERB_MAP = {
  remembering: ["define", "list", "identify", "state", "recall", "name", "recognize", "select", "match", "label"],
  understanding: ["explain", "summarize", "describe", "classify", "interpret", "discuss", "paraphrase", "translate"],
  applying: ["apply", "use", "implement", "execute", "demonstrate", "solve", "compute", "calculate", "operate"],
  analyzing: ["analyze", "compare", "differentiate", "diagram", "break down", "examine", "categorize", "distinguish"],
  evaluating: ["evaluate", "justify", "critique", "argue", "defend", "assess", "judge", "recommend", "support"],
  creating: ["design", "create", "compose", "formulate", "construct", "develop", "invent", "produce", "synthesize"]
};

// Knowledge dimension keywords
const KNOWLEDGE_KEYWORDS = {
  factual: ["define", "list", "identify", "name", "who", "what", "when", "where", "recall", "state"],
  conceptual: ["explain", "describe", "classify", "compare", "contrast", "interpret", "why", "how"],
  procedural: ["apply", "use", "implement", "solve", "demonstrate", "execute", "perform", "operate"],
  metacognitive: ["evaluate", "justify", "critique", "assess", "reflect", "analyze own", "self-assess"]
};

// Difficulty indicators
const DIFFICULTY_INDICATORS = {
  easy: ["define", "list", "identify", "recall", "state", "name", "select", "match"],
  average: ["explain", "describe", "apply", "use", "compare", "classify", "solve"],
  difficult: ["analyze", "evaluate", "create", "design", "justify", "critique", "synthesize", "formulate"]
};

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function ruleCategorize(questionText: string): ClassificationResult {
  const text = questionText.toLowerCase().trim();
  
  // Find Bloom's level based on verbs
  let bloom_level = "Understanding"; // default
  let bloom_confidence = 0.5;
  
  for (const [level, verbs] of Object.entries(VERB_MAP)) {
    for (const verb of verbs) {
      if (text.startsWith(verb + " ") || text.includes(` ${verb} `) || text.includes(`${verb}.`)) {
        bloom_level = capitalizeFirst(level);
        bloom_confidence = 0.8;
        break;
      }
    }
    if (bloom_confidence > 0.5) break;
  }
  
  // Determine difficulty
  let difficulty = "Average"; // default
  let difficulty_confidence = 0.5;
  
  for (const [level, indicators] of Object.entries(DIFFICULTY_INDICATORS)) {
    for (const indicator of indicators) {
      if (text.includes(indicator)) {
        difficulty = capitalizeFirst(level);
        difficulty_confidence = 0.7;
        break;
      }
    }
  }
  
  // Sentence complexity can also indicate difficulty
  const words = text.split(' ').length;
  if (words > 25) {
    difficulty = "Difficult";
    difficulty_confidence = Math.min(difficulty_confidence + 0.1, 0.9);
  } else if (words < 10) {
    difficulty = "Easy";
    difficulty_confidence = Math.min(difficulty_confidence + 0.1, 0.9);
  }
  
  // Determine knowledge dimension
  let knowledge_dimension = "Conceptual"; // default
  let knowledge_confidence = 0.5;
  
  for (const [dimension, keywords] of Object.entries(KNOWLEDGE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        knowledge_dimension = capitalizeFirst(dimension);
        knowledge_confidence = 0.7;
        break;
      }
    }
    if (knowledge_confidence > 0.5) break;
  }
  
  // Calculate overall confidence
  const confidence_score = (bloom_confidence + difficulty_confidence + knowledge_confidence) / 3;
  
  return {
    bloom_level,
    difficulty,
    knowledge_dimension,
    confidence_score: Math.round(confidence_score * 100) / 100
  };
}

// Enhanced classification with context
export function classifyQuestionWithContext(
  questionText: string, 
  topic?: string, 
  choices?: Record<string, string>
): ClassificationResult {
  const baseClassification = ruleCategorize(questionText);
  
  // Adjust based on multiple choice complexity
  if (choices) {
    const choiceTexts = Object.values(choices);
    const avgChoiceLength = choiceTexts.reduce((sum, choice) => sum + choice.length, 0) / choiceTexts.length;
    
    if (avgChoiceLength > 50) {
      // Complex choices indicate higher difficulty
      if (baseClassification.difficulty === "Easy") {
        baseClassification.difficulty = "Average";
      } else if (baseClassification.difficulty === "Average") {
        baseClassification.difficulty = "Difficult";
      }
      baseClassification.confidence_score = Math.min(baseClassification.confidence_score + 0.1, 1.0);
    }
  }
  
  // Topic-specific adjustments
  if (topic) {
    const topicLower = topic.toLowerCase();
    if (topicLower.includes("advanced") || topicLower.includes("complex")) {
      if (baseClassification.difficulty !== "Difficult") {
        baseClassification.difficulty = "Average";
      }
    }
  }
  
  return baseClassification;
}

// Batch classification for imports
export function classifyQuestions(questions: Array<{ text: string; topic?: string; choices?: Record<string, string> }>): ClassificationResult[] {
  return questions.map(q => classifyQuestionWithContext(q.text, q.topic, q.choices));
}