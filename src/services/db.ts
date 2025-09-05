import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { RealtimeChannel } from '@supabase/supabase-js';

// Type definitions
export type Profile = Database['public']['Tables']['profiles']['Row'];
export type Question = Database['public']['Tables']['questions']['Row'];
export type TestMetadata = Database['public']['Tables']['test_metadata']['Row'];
export type TestVersion = Database['public']['Tables']['test_versions']['Row'];
export type Rubric = Database['public']['Tables']['rubrics']['Row'];
export type QuestionRubric = Database['public']['Tables']['question_rubrics']['Row'];
export type StudentResponse = Database['public']['Tables']['student_responses']['Row'];

// TOS Entry type (from migration schema)
export type TOSEntry = {
  id: string;
  owner?: string;
  title: string;
  subject_no: string;
  course: string;
  description: string;
  year_section: string;
  exam_period: string;
  school_year: string;
  total_items: number;
  prepared_by: string;
  noted_by: string;
  topics: any;
  distribution: any;
  matrix: any;
  created_at: string;
  updated_at?: string;
  created_by?: string;
};

// Generated Test type (from migration schema)
export type GeneratedTest = {
  id: string;
  owner?: string;
  tos_id?: string;
  title?: string;
  params: any;
  created_at: string;
};

// Authentication helpers
export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
}

export async function getProfile() {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  
  if (error) throw error;
  return data;
}

// TOS Operations
export const TOS = {
  create: async (payload: Partial<TOSEntry>) => {
    const user = await getCurrentUser();
    const insert = { 
      ...payload, 
      owner: user?.id,
      created_by: 'teacher',
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('tos_entries')
      .insert(insert)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  listMine: async () => {
    const { data, error } = await supabase
      .from('tos_entries')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  update: async (id: string, patch: Partial<TOSEntry>) => {
    const updateData = {
      ...patch,
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('tos_entries')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  delete: async (id: string) => {
    const { error } = await supabase
      .from('tos_entries')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  },

  addCollaborator: async (tosId: string, userId: string, canEdit: boolean = true) => {
    const { data, error } = await supabase
      .from('tos_collaborators')
      .insert({ tos_id: tosId, user_id: userId, can_edit: canEdit })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
};

// Question Operations
export const Questions = {
  insertMany: async (rows: Partial<Question>[]) => {
    const user = await getCurrentUser();
    const withOwner = rows.map(r => ({ 
      owner: user?.id, 
      created_by: r.created_by || 'teacher',
      approved: r.approved || false,
      confidence_score: r.ai_confidence_score || 0.7,
      needs_review: r.needs_review || false,
      updated_at: new Date().toISOString(),
      ...r 
    }));
    
    const { data, error } = await supabase
      .from('questions')
      .insert(withOwner)
      .select();
    
    if (error) throw error;
    return data;
  },

  search: async (filters: {
    topic?: string;
    bloom_level?: string;
    difficulty?: string;
    approved?: boolean;
    search?: string;
    created_by?: string;
    needs_review?: boolean;
  }) => {
    let query = supabase.from('questions').select('*');
    
    if (filters.topic) query = query.eq('topic', filters.topic);
    if (filters.bloom_level) query = query.eq('bloom_level', filters.bloom_level);
    if (filters.difficulty) query = query.eq('difficulty', filters.difficulty);
    if (filters.approved !== undefined) query = query.eq('approved', filters.approved);
    if (filters.created_by) query = query.eq('created_by', filters.created_by);
    if (filters.needs_review !== undefined) query = query.eq('needs_review', filters.needs_review);
    if (filters.search) {
      query = query.or(`question_text.ilike.%${filters.search}%,topic.ilike.%${filters.search}%`);
    }
    
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  toggleApproval: async (id: string, approved: boolean, notes?: string) => {
    const user = await getCurrentUser();
    const { data, error } = await supabase
      .from('questions')
      .update({ 
        approved, 
        approved_by: user?.email,
        approval_notes: notes,
        approval_confidence: approved ? 1.0 : 0.0,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  update: async (id: string, patch: Partial<Question>) => {
    const updateData = {
      ...patch,
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('questions')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  delete: async (id: string) => {
    const { error } = await supabase
      .from('questions')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  }
};

// Test Operations
export const Tests = {
  create: async (metadata: Partial<TestMetadata & { tos_id?: string }>) => {
    const user = await getCurrentUser();
    const testData = {
      ...metadata,
      created_by: 'teacher',
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('test_metadata')
      .insert(testData)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  createGenerated: async (tosId: string, title: string, params: any) => {
    const user = await getCurrentUser();
    const { data, error } = await supabase
      .from('generated_tests')
      .insert({ 
        owner: user?.id, 
        tos_id: tosId, 
        title, 
        params 
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  addVersion: async (
    testMetadataId: string, 
    label: string, 
    questions: any[], 
    answerKey: Record<string, string>,
    totalPoints: number
  ) => {
    const questionOrder = questions.map((_, index) => index + 1);
    
    const { data, error } = await supabase
      .from('test_versions')
      .insert({
        test_metadata_id: testMetadataId,
        version_label: label,
        question_order: questions.map(q => q.id),
        answer_key: answerKey,
        total_points: totalPoints,
        questions: questions
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  listMine: async () => {
    const { data, error } = await supabase
      .from('test_metadata')
      .select(`
        *,
        versions:test_versions(*)
      `)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  getVersions: async (testMetadataId: string) => {
    const { data, error } = await supabase
      .from('test_versions')
      .select('*')
      .eq('test_metadata_id', testMetadataId)
      .order('version_label');
    
    if (error) throw error;
    return data;
  },

  delete: async (id: string) => {
    const { error } = await supabase
      .from('test_metadata')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  }
};

// Rubric Operations
export const Rubrics = {
  create: async (rubric: Partial<Rubric>) => {
    const user = await getCurrentUser();
    const rubricData = {
      ...rubric,
      created_by: 'teacher',
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('rubrics')
      .insert(rubricData)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  listAll: async () => {
    const { data, error } = await supabase
      .from('rubrics')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  delete: async (id: string) => {
    const { error } = await supabase
      .from('rubrics')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  },

  attachToQuestion: async (questionId: string, rubricData: any) => {
    // Create question-specific rubric
    const { data: questionRubric, error: rubricError } = await supabase
      .from('question_rubrics')
      .insert({
        question_id: questionId,
        title: rubricData.title,
        description: rubricData.description,
        total_points: rubricData.total_points
      })
      .select()
      .single();
    
    if (rubricError) throw rubricError;

    // Add criteria
    const criteriaData = rubricData.criteria.map((criterion: any, index: number) => ({
      rubric_id: questionRubric.id,
      criterion_name: criterion.criterion_name,
      description: criterion.description,
      max_points: criterion.max_points,
      order_index: index
    }));

    const { error: criteriaError } = await supabase
      .from('rubric_criteria')
      .insert(criteriaData);
    
    if (criteriaError) throw criteriaError;
    return questionRubric;
  },

  getForQuestion: async (questionId: string) => {
    const { data, error } = await supabase
      .from('question_rubrics')
      .select(`
        *,
        criteria:rubric_criteria(*)
      `)
      .eq('question_id', questionId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }
};

// Analytics Operations
export const Analytics = {
  bloomCounts: async () => {
    const { data, error } = await supabase
      .from('questions')
      .select('bloom_level');
    
    if (error) throw error;
    
    const counts = (data || []).reduce((acc: Record<string, number>, item) => {
      acc[item.bloom_level] = (acc[item.bloom_level] || 0) + 1;
      return acc;
    }, {});
    
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  },

  difficultyCounts: async () => {
    const { data, error } = await supabase
      .from('questions')
      .select('difficulty');
    
    if (error) throw error;
    
    const counts = (data || []).reduce((acc: Record<string, number>, item) => {
      acc[item.difficulty] = (acc[item.difficulty] || 0) + 1;
      return acc;
    }, {});
    
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  },

  creatorStats: async () => {
    const { data, error } = await supabase
      .from('questions')
      .select('created_by');
    
    if (error) throw error;
    
    const counts = (data || []).reduce((acc: Record<string, number>, item) => {
      const creator = (item.created_by === 'ai' || item.created_by === 'bulk_import') ? 'AI Generated' : 'Teacher Created';
      acc[creator] = (acc[creator] || 0) + 1;
      return acc;
    }, {});
    
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  },

  activityTimeline: async () => {
    const { data, error } = await supabase
      .from('activities')
      .select('created_at, action_type')
      .gte('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at');
    
    if (error) throw error;
    
    const dailyCounts = (data || []).reduce((acc: Record<string, number>, activity) => {
      const date = new Date(activity.created_at).toLocaleDateString();
      acc[date] = (acc[date] || 0) + 1;
      return acc;
    }, {});
    
    return Object.entries(dailyCounts).map(([date, count]) => ({ date, count }));
  },

  approvalStats: async () => {
    const { data, error } = await supabase
      .from('questions')
      .select('approved');
    
    if (error) throw error;
    
    const approved = (data || []).filter(q => q.approved).length;
    const pending = (data || []).length - approved;
    
    return [
      { name: 'Approved', value: approved },
      { name: 'Pending Review', value: pending }
    ];
  },

  topicCounts: async () => {
    const { data, error } = await supabase
      .from('questions')
      .select('topic');
    
    if (error) throw error;
    
    const counts = (data || []).reduce((acc: Record<string, number>, item) => {
      acc[item.topic] = (acc[item.topic] || 0) + 1;
      return acc;
    }, {});
    
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }
};

// Activity Logging
export const ActivityLog = {
  log: async (actionType: string, targetType?: string, targetId?: string, metadata?: any) => {
    const user = await getCurrentUser();
    
    const { error } = await supabase
      .from('activities')
      .insert({
        actor: user?.id,
        type: actionType,
        meta: {
          target_type: targetType,
          target_id: targetId,
          ...metadata
        }
      });
    
    if (error) throw error;
  }
};

// Bulk Import Operations
export const BulkImport = {
  create: async (filename: string) => {
    const user = await getCurrentUser();
    
    const { data, error } = await supabase
      .from('bulk_imports')
      .insert({
        owner: user?.id,
        filename,
        status: 'processing'
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  updateStatus: async (id: string, status: string, summary?: any) => {
    const { data, error } = await supabase
      .from('bulk_imports')
      .update({ status, summary })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
};

// Student Response Operations
export const StudentResponses = {
  create: async (responseData: Partial<StudentResponse>) => {
    const { data, error } = await supabase
      .from('student_responses')
      .insert(responseData)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  listByQuestion: async (questionId: string) => {
    const { data, error } = await supabase
      .from('student_responses')
      .select('*')
      .eq('question_id', questionId)
      .order('submitted_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  updateGrade: async (id: string, totalScore: number, gradedBy: string) => {
    const { data, error } = await supabase
      .from('student_responses')
      .update({
        graded: true,
        total_score: totalScore,
        graded_by: gradedBy,
        graded_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
};

// Realtime Subscriptions
export const Realtime = {
  subscribeToQuestions: (callback: (payload: any) => void): RealtimeChannel => {
    return supabase
      .channel('questions-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'questions' }, callback)
      .subscribe();
  },

  subscribeToActivities: (callback: (payload: any) => void): RealtimeChannel => {
    return supabase
      .channel('activities-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activities' }, callback)
      .subscribe();
  },

  unsubscribe: (channel: RealtimeChannel) => {
    supabase.removeChannel(channel);
  }
};