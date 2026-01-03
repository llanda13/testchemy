import { supabase } from "@/integrations/supabase/client";
import type { KnowledgeDimension } from "@/types/knowledge";
import { generateWithIntent, IntentRegistry } from "./intentDrivenGenerator";


export interface TOSCriteria {
  topic: string;
  bloom_level: string;
  knowledge_dimension?: string;
  difficulty: string;
  count: number;
}

export interface GeneratedTest {
  id: string;
  title: string;
  questions: any[];
  answer_key: any[];
  generated_at: string;
}

/**
 * Generate a test based on Table of Specifications
 * This function implements the non-redundant question selection mechanism
 */
export async function generateTestFromTOS(
  tosCriteria: TOSCriteria[],
  testTitle: string,
  testMetadata?: any
): Promise<GeneratedTest> {
  console.log("🧠 === STARTING TEST GENERATION ===");
  console.log("📋 TOS Criteria:", JSON.stringify(tosCriteria, null, 2));
  console.log("📝 Test Title:", testTitle);
  console.log("📦 Test Metadata:", JSON.stringify(testMetadata, null, 2));

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.error("❌ User not authenticated");
    throw new Error("User not authenticated");
  }
  console.log("✅ User authenticated:", user.id);

  const selectedQuestions: any[] = [];
  const answerKey: any[] = [];
  let questionNumber = 1;

  // Session-level persistence: one registry for the whole test generation run
  // (prevents repeating the same concept + operation across criteria)
  const sessionIntentRegistry = new IntentRegistry();

  for (const criteria of tosCriteria) {
    console.log(`\n📊 Processing Criteria: ${criteria.topic} | ${criteria.bloom_level} | ${criteria.difficulty} | Need: ${criteria.count}`);
    
    // Step 1: Query existing AVAILABLE questions matching criteria (not just approved)
    const normalizedTopic = criteria.topic.toLowerCase().replace(/[_\-]/g, ' ').trim();
    const normalizedBloom = criteria.bloom_level.toLowerCase().trim();
    
    const { data: existingQuestions, error: queryError } = await supabase
      .from('questions')
      .select('*')
      .eq('deleted', false)
      .or(`topic.ilike.%${normalizedTopic}%,topic.ilike.%${criteria.topic}%`)
      .or(`bloom_level.ilike.${normalizedBloom},bloom_level.ilike.${criteria.bloom_level}`);

    if (queryError) {
      console.error("❌ Error querying questions:", queryError);
      continue;
    }

    console.log(`   ✓ Found ${existingQuestions?.length || 0} existing questions`);

    let questionsToUse: any[] = [];

    if (existingQuestions && existingQuestions.length >= criteria.count) {
      console.log(`   ✓ Sufficient questions available - selecting ${criteria.count} non-redundant`);
      // Step 2: Use semantic similarity to select non-redundant questions
      questionsToUse = await selectNonRedundantQuestions(
        existingQuestions,
        criteria.count
      );
      console.log(`   ✓ Selected ${questionsToUse.length} questions`);
    } else {
      // Step 3: Need to generate new questions via AI
      const neededCount = criteria.count - (existingQuestions?.length || 0);
      console.log(`   ⚠️ Insufficient questions - need ${neededCount} more`);
      console.log(`   🤖 Activating AI Fallback Generation...`);
      
      // Use existing questions first
      questionsToUse = existingQuestions || [];

      try {
        // Generate new questions
        const newQuestions = await generateQuestionsWithAI(
          criteria,
          neededCount,
          user.id,
          sessionIntentRegistry
        );
        console.log(`   ✓ AI generated ${newQuestions.length} questions`);
        console.log(`   📄 Sample AI question:`, newQuestions[0] ? {
          id: newQuestions[0].id,
          question_text: newQuestions[0].question_text?.substring(0, 50) + '...',
          type: newQuestions[0].question_type,
          hasChoices: !!newQuestions[0].choices,
          hasAnswer: !!newQuestions[0].correct_answer
        } : 'none');

        questionsToUse = [...questionsToUse, ...newQuestions];
      } catch (aiError) {
        console.error(`   ❌ AI generation failed:`, aiError);
        throw new Error(`AI generation failed for ${criteria.topic}: ${aiError instanceof Error ? aiError.message : 'Unknown error'}`);
      }
    }

    console.log(`   📝 Adding ${questionsToUse.length} questions to test (starting at #${questionNumber})`);
    
    // Add to test with question numbers
    questionsToUse.forEach(q => {
      if (!q.question_text || !q.correct_answer) {
        console.warn(`   ⚠️ Question missing required fields:`, {
          id: q.id,
          hasText: !!q.question_text,
          hasAnswer: !!q.correct_answer
        });
      }
      
      selectedQuestions.push({
        ...q,
        question_number: questionNumber++
      });
      
      answerKey.push({
        question_number: questionNumber - 1,
        question_id: q.id,
        correct_answer: q.correct_answer,
        points: 1
      });
    });
  }

  console.log(`\n✅ Assembled ${selectedQuestions.length} total questions`);
  console.log(`📋 Answer key has ${answerKey.length} entries`);

  if (selectedQuestions.length === 0) {
    console.error("❌ No questions were assembled!");
    throw new Error("No questions were generated. Please check your TOS criteria.");
  }

  // Step 4: Store generated test
  const testData = {
    title: testTitle,
    subject: testMetadata?.subject || null,
    course: testMetadata?.course || null,
    year_section: testMetadata?.year_section || null,
    exam_period: testMetadata?.exam_period || null,
    school_year: testMetadata?.school_year || null,
    items: selectedQuestions,
    answer_key: answerKey,
    tos_id: testMetadata?.tos_id || null,
    points_per_question: testMetadata?.points_per_question || 1,
    created_by: user.id  // Required for RLS policy
  };

  console.log(`\n💾 Saving test to database...`);
  console.log(`   Test structure:`, {
    title: testData.title,
    itemsCount: selectedQuestions.length,
    answerKeyCount: answerKey.length,
    hasMetadata: !!testMetadata,
    tos_id: testData.tos_id
  });
  
  // CRITICAL: Validate TOS ID before inserting
  if (!testData.tos_id) {
    console.error("❌ No TOS ID provided in metadata!");
    throw new Error("Cannot save test without valid TOS ID");
  }
  
  // Verify TOS exists in database
  const { data: tosEntry, error: tosError } = await supabase
    .from('tos_entries')
    .select('id')
    .eq('id', testData.tos_id)
    .single();

  if (tosError || !tosEntry) {
    console.error("❌ TOS entry not found:", testData.tos_id);
    throw new Error(`TOS entry not found (${testData.tos_id}). Please create TOS first.`);
  }
  
  console.log(`   ✓ TOS exists in database: ${testData.tos_id}`);

  const { data: generatedTest, error: insertError } = await supabase
    .from('generated_tests')
    .insert(testData)
    .select()
    .single();

  if (insertError) {
    console.error("❌ Database insert error:", insertError);
    console.error("   Error details:", JSON.stringify(insertError, null, 2));
    throw new Error(`Failed to save test: ${insertError.message}`);
  }

  if (!generatedTest) {
    console.error("❌ No test returned from database");
    throw new Error("Failed to create test - no data returned");
  }

  console.log(`✅ Test saved successfully! ID: ${generatedTest.id}`);
  console.log("🧠 === TEST GENERATION COMPLETE ===\n");

  return {
    id: generatedTest.id,
    title: generatedTest.title,
    questions: selectedQuestions,
    answer_key: answerKey,
    generated_at: generatedTest.created_at
  };
}

/**
 * Select non-redundant questions using semantic similarity
 * Ensures selected questions have similarity < 0.85
 */
async function selectNonRedundantQuestions(
  questions: any[],
  count: number
): Promise<any[]> {
  const selected: any[] = [];
  const similarityThreshold = 0.85;

  // Sort by usage count (prefer less-used questions)
  const sortedQuestions = [...questions].sort((a, b) => 
    (a.used_count || 0) - (b.used_count || 0)
  );

  for (const question of sortedQuestions) {
    if (selected.length >= count) break;

    // Check semantic similarity with already selected questions
    let isSimilar = false;
    
    for (const selectedQ of selected) {
      if (question.semantic_vector && selectedQ.semantic_vector) {
        // Use check_question_similarity function
        const { data: similarQuestions } = await supabase
          .rpc('check_question_similarity', {
            p_question_text: question.question_text,
            p_topic: question.topic,
            p_bloom_level: question.bloom_level,
            p_threshold: similarityThreshold
          });

        if (similarQuestions && similarQuestions.length > 0) {
          // Check if any similar question is already selected
          const similarToSelected = similarQuestions.some((sq: any) => 
            selected.some(s => s.id === sq.similar_question_id)
          );
          if (similarToSelected) {
            isSimilar = true;
            break;
          }
        }
      }
    }

    if (!isSimilar) {
      selected.push(question);
      
      // Mark question as used
      await supabase.rpc('mark_question_used', { 
        p_question_id: question.id,
        p_test_id: null
      });
    }
  }

  return selected;
}

/**
 * Generate new questions using AI when existing questions are insufficient
 */
/**
 * Generate new questions using AI when existing questions are insufficient
 *
 * IMPORTANT: This uses the intent-driven pipeline (concept + operation + answer structure)
 * so redundancy becomes structurally impossible.
 */
async function generateQuestionsWithAI(
  criteria: TOSCriteria,
  count: number,
  userId: string,
  registry: IntentRegistry
): Promise<any[]> {
  console.log(`   🤖 Calling intent-driven AI generation...`);
  console.log(
    `      Topic: ${criteria.topic}, Bloom: ${criteria.bloom_level}, Difficulty: ${criteria.difficulty}, Count: ${count}`
  );

  const bloomRaw = String(criteria.bloom_level || '').toLowerCase().trim();
  const difficultyRaw = String(criteria.difficulty || 'average').toLowerCase().trim();

  const bloomCanonicalMap: Record<string, string> = {
    remember: 'Remembering',
    remembering: 'Remembering',
    understand: 'Understanding',
    understanding: 'Understanding',
    apply: 'Applying',
    applying: 'Applying',
    analyze: 'Analyzing',
    analyzing: 'Analyzing',
    evaluate: 'Evaluating',
    evaluating: 'Evaluating',
    create: 'Creating',
    creating: 'Creating'
  };

  const bloomCanonical = bloomCanonicalMap[bloomRaw] || 'Understanding';
  const bloomStored = (bloomRaw in bloomCanonicalMap ? bloomRaw : 'understanding').endsWith('ing')
    ? (bloomRaw in bloomCanonicalMap ? bloomRaw : 'understanding')
    : (bloomRaw in bloomCanonicalMap ? `${bloomRaw}ing` : 'understanding');

  const difficultyStored =
    difficultyRaw === 'medium' ? 'average' :
    difficultyRaw === 'hard' ? 'difficult' :
    difficultyRaw;

  const difficultyCanonical =
    difficultyStored === 'easy' ? 'Easy' :
    difficultyStored === 'difficult' ? 'Difficult' :
    'Average';

  const knowledgeDimension = (String(criteria.knowledge_dimension || 'conceptual').toLowerCase().trim() as KnowledgeDimension);

  // Keep question types stable: only "Creating" becomes essay, others default to MCQ.
  // (Avoids changing UI behavior while eliminating verb-swapping redundancy.)
  const questionType: 'mcq' | 'essay' = bloomCanonical === 'Creating' ? 'essay' : 'mcq';

  const result = await generateWithIntent({
    topic: criteria.topic,
    bloomLevel: bloomCanonical,
    knowledgeDimension,
    difficulty: difficultyCanonical,
    count,
    questionType,
    registry
  });

  if (!result.success) {
    throw new Error(result.error || 'Intent-driven AI generation failed');
  }

  const questionsToInsert = (result.questions || []).map((q) => ({
    question_text: q.text,
    question_type: questionType,
    choices: questionType === 'mcq' ? (q.choices || null) : null,
    correct_answer: questionType === 'mcq' ? (q.correct_answer || 'A') : (q.answer || ''),
    topic: criteria.topic,
    bloom_level: bloomStored,
    difficulty: difficultyStored,
    knowledge_dimension: knowledgeDimension,
    created_by: 'ai',
    status: 'approved',
    approved: true,
    owner: userId,
    ai_confidence_score: q.structure_validated === false ? 0.55 : 0.75,
    needs_review: q.structure_validated === false,
    metadata: {
      pipeline_mode: 'intent_driven',
      assigned_concept: q.assigned_concept,
      assigned_operation: q.assigned_operation,
      why_unique: q.why_unique,
      rejection_reasons: q.rejection_reasons,
      structure_validated: q.structure_validated
    }
  }));

  console.log(`   💾 Saving ${questionsToInsert.length} intent-driven AI questions to database...`);

  const { data: insertedQuestions, error: insertError } = await supabase
    .from('questions')
    .insert(questionsToInsert)
    .select();

  if (insertError) {
    console.error("   ❌ Error inserting generated questions:", insertError);
    console.error("      Insert error details:", JSON.stringify(insertError, null, 2));
    console.warn("   ⚠️ Using generated questions without saving to bank");
    return questionsToInsert;
  }

  console.log(`   ✅ Successfully inserted ${insertedQuestions?.length || 0} questions into bank`);

  // Log AI generation for tracking (best-effort, fire-and-forget)
  for (const question of insertedQuestions || []) {
    (async () => {
      try {
        await supabase.from('ai_generation_logs').insert({
          question_id: question.id,
          generation_type: 'tos_generation',
          prompt_used: `Intent-driven: ${bloomCanonical} (${knowledgeDimension}) on ${criteria.topic}`,
          model_used: 'intent_driven_pipeline',
          generated_by: userId
        });
      } catch {
        // Best-effort logging, ignore errors
      }
    })();
  }

  // Semantic vector generation (async, fire-and-forget)
  for (const question of insertedQuestions || []) {
    (async () => {
      try {
        await supabase.functions.invoke('update-semantic', {
          body: {
            question_id: question.id,
            question_text: question.question_text
          }
        });
      } catch (err) {
        console.error('   ⚠️ Error updating semantic vector:', err);
      }
    })();
  }

  // Semantic similarity calculation (async, fire-and-forget)
  for (const question of insertedQuestions || []) {
    (async () => {
      try {
        await supabase.functions.invoke('semantic-similarity', {
          body: {
            questionText: question.question_text,
            questionId: question.id,
            threshold: 0.7
          }
        });
      } catch (err) {
        console.error('   ⚠️ Error storing semantic similarity:', err);
      }
    })();
  }

  return insertedQuestions || questionsToInsert;
}

/**
 * Generate automatic answer key for a test
 */
export function generateAnswerKey(questions: any[]): any[] {
  return questions.map((q, index) => ({
    question_number: index + 1,
    question_id: q.id,
    correct_answer: q.correct_answer,
    question_text: q.question_text,
    points: 1,
    bloom_level: q.bloom_level,
    topic: q.topic
  }));
}