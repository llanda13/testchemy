import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { questions } = await req.json();
    
    if (!questions || !Array.isArray(questions)) {
      return new Response(
        JSON.stringify({ error: 'Invalid input: questions array required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get OpenAI API key
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      return new Response(
        JSON.stringify({ error: 'OpenAI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const classifications = [];

    // Process questions in batches to avoid rate limits
    const batchSize = 5;
    for (let i = 0; i < questions.length; i += batchSize) {
      const batch = questions.slice(i, i + batchSize);
      
      const prompt = `Classify each of the following educational questions according to:
1. Bloom's Taxonomy Level (Remembering, Understanding, Applying, Analyzing, Evaluating, Creating)
2. Knowledge Dimension (Factual, Conceptual, Procedural, Metacognitive)
3. Difficulty Level (Easy, Average, Difficult)

Questions to classify:
${batch.map((q: any, index: number) => `${i + index + 1}. ${q.text}`).join('\n')}

Return a JSON object with a "classifications" array containing objects in this exact format:
{
  "classifications": [
    {
      "index": 0,
      "bloom_level": "Understanding",
      "knowledge_dimension": "Conceptual", 
      "difficulty": "Average",
      "confidence": 0.85,
      "reasoning": "Brief explanation of classification"
    }
  ]
}`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAIApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are an expert in educational assessment and Bloom\'s taxonomy. Classify questions accurately based on cognitive demands and knowledge types.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
          max_tokens: 2000
        }),
      });

      if (!response.ok) {
        console.error('OpenAI API error for batch:', await response.text());
        // Return rule-based classification as fallback
        const fallbackClassifications = batch.map((q: any, batchIndex: number) => ({
          index: i + batchIndex,
          bloom_level: 'Understanding',
          knowledge_dimension: 'Conceptual',
          difficulty: 'Average',
          confidence: 0.5,
          reasoning: 'Fallback classification due to AI service error'
        }));
        classifications.push(...fallbackClassifications);
        continue;
      }

      const aiResponse = await response.json();
      
      try {
        const content = JSON.parse(aiResponse.choices[0].message.content);
        const batchClassifications = content.classifications || [];
        
        // Validate and add to results
        for (const classification of batchClassifications) {
          if (classification.index !== undefined) {
            classifications.push(classification);
          }
        }
      } catch (parseError) {
        console.error('Failed to parse AI response for batch:', parseError);
        // Add fallback classifications
        const fallbackClassifications = batch.map((q: any, batchIndex: number) => ({
          index: i + batchIndex,
          bloom_level: 'Understanding',
          knowledge_dimension: 'Conceptual',
          difficulty: 'Average',
          confidence: 0.5,
          reasoning: 'Fallback classification due to parsing error'
        }));
        classifications.push(...fallbackClassifications);
      }

      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return new Response(
      JSON.stringify({
        success: true,
        classifications
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'An unexpected error occurred', details: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});