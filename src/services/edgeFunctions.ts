import { supabase } from "@/integrations/supabase/client";

export interface ClassificationInput {
  text: string;
  type: 'mcq' | 'true_false' | 'essay' | 'short_answer';
  topic?: string;
}

export interface ClassificationOutput {
  bloom_level: string;
  difficulty: string;
  knowledge_dimension: string;
  confidence: number;
  needs_review: boolean;
}

export interface GenerationInput {
  tos_id: string;
  total_items: number;
  distributions: Array<{
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
  }>;
  allow_unapproved?: boolean;
  prefer_existing?: boolean;
}

export interface GenerationOutput {
  questions: any[];
  generation_log: any[];
  statistics: {
    total_generated: number;
    from_bank: number;
    ai_generated: number;
    by_bloom: Record<string, number>;
    by_difficulty: Record<string, number>;
    needs_review: number;
  };
  tos_id: string;
}

export class EdgeFunctions {
  private static getBaseUrl(): string {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!supabaseUrl) {
      throw new Error('VITE_SUPABASE_URL is not configured');
    }
    return `${supabaseUrl}/functions/v1`;
  }

  private static async makeRequest(endpoint: string, payload: any): Promise<any> {
    const { data: { session } } = await supabase.auth.getSession();
    
    const response = await fetch(`${this.getBaseUrl()}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Edge function error (${response.status}): ${errorText}`);
    }

    return await response.json();
  }

  static async classifyQuestions(
    questions: ClassificationInput[],
    onProgress?: (progress: number) => void
  ): Promise<ClassificationOutput[]> {
    try {
      // Process in batches for better performance and progress tracking
      const batchSize = 10;
      const results: ClassificationOutput[] = [];
      
      for (let i = 0; i < questions.length; i += batchSize) {
        const batch = questions.slice(i, i + batchSize);
        const batchResults = await this.makeRequest('classify-questions', batch);
        
        if (!Array.isArray(batchResults)) {
          throw new Error('Invalid response format from classify-questions');
        }
        
        results.push(...batchResults);
        
        // Report progress
        if (onProgress) {
          const progress = Math.min(100, ((i + batch.length) / questions.length) * 100);
          onProgress(progress);
        }
      }
      
      return results;
    } catch (error) {
      console.error('Classification error:', error);
      throw new Error(`Question classification failed: ${error.message}`);
    }
  }

  static async generateQuestionsFromTOS(
    input: GenerationInput,
    onProgress?: (status: string, progress: number) => void
  ): Promise<GenerationOutput> {
    try {
      onProgress?.('Analyzing TOS matrix...', 10);
      
      const result = await this.makeRequest('generate-questions-from-tos', input);
      
      onProgress?.('Processing generated questions...', 80);
      
      if (!result.questions || !Array.isArray(result.questions)) {
        throw new Error('Invalid response format from generate-questions-from-tos');
      }
      
      onProgress?.('Finalizing question set...', 100);
      
      return result;
    } catch (error) {
      console.error('Generation error:', error);
      throw new Error(`Question generation failed: ${error.message}`);
    }
  }

  static async classifySingleQuestion(
    text: string,
    type: string,
    topic?: string
  ): Promise<ClassificationOutput> {
    const results = await this.classifyQuestions([{ text, type: type as any, topic }]);
    return results[0];
  }

  // Utility method to test edge function connectivity
  static async testConnection(): Promise<boolean> {
    try {
      await this.classifyQuestions([{
        text: "Define the term 'test'.",
        type: 'mcq'
      }]);
      return true;
    } catch (error) {
      console.error('Edge function connection test failed:', error);
      return false;
    }
  }
}

/**
 * Standalone export for classifyQuestions to maintain backward compatibility
 * Calls the Supabase Edge Function `classify-questions` to classify bulk questions
 * with Bloom level, Knowledge Dimension, and Difficulty.
 *
 * @param questions Array of objects: { text: string, type: string, topic?: string }
 * @returns Array of classification results with bloom_level, difficulty, knowledge_dimension, confidence, needs_review
 */
export async function classifyQuestions(
  questions: Array<{ text: string; type: string; topic?: string }>
): Promise<Array<{
  bloom_level: string;
  difficulty: string;
  knowledge_dimension: string;
  confidence: number;
  needs_review: boolean;
}>> {
  try {
    const { data, error } = await supabase.functions.invoke('classify-questions', {
      body: questions,
    });

    if (error) {
      console.error('Supabase Edge Function Error:', error);
      throw error;
    }

    if (!Array.isArray(data)) {
      throw new Error('Invalid response format from classify-questions Edge Function');
    }

    return data;
  } catch (err) {
    console.error('Error calling classifyQuestions Edge Function:', err);
    throw err;
  }
}