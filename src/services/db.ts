// Data Access Layer for AI-Integrated Test Bank System
import { supabase } from '@/integrations/supabase/client';

// Profile Service
export const ProfileService = {
  async getCurrent() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    
    if (error) throw error;
    return data;
  },

  async update(updates: any) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
};

// TOS Service
export const TOSService = {
  async create(payload: any) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    
    const insert = { ...payload, owner: user.id };
    const { data, error } = await supabase
      .from('tos_entries')
      .insert(insert)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async list() {
    const { data, error } = await supabase
      .from('tos_entries')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from('tos_entries')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data;
  },

  async update(id: string, updates: any) {
    const { data, error } = await supabase
      .from('tos_entries')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async delete(id: string) {
    const { error } = await supabase
      .from('tos_entries')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  }
};

// Questions Service
export const QuestionsService = {
  async create(payload: any) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    
    const insert = { ...payload, owner: user.id };
    const { data, error } = await supabase
      .from('questions')
      .insert(insert)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async insertMany(rows: any[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    
    const withOwner = rows.map(r => ({ ...r, owner: user.id }));
    const { data, error } = await supabase
      .from('questions')
      .insert(withOwner)
      .select();
    
    if (error) throw error;
    return data || [];
  },

  async search(filters: {
    topic?: string;
    bloom_level?: string;
    difficulty?: string;
    approved?: boolean;
    tos_id?: string;
    created_by?: string;
  } = {}) {
    let query = supabase.from('questions').select('*');
    
    if (filters.topic) query = query.eq('topic', filters.topic);
    if (filters.bloom_level) query = query.eq('bloom_level', filters.bloom_level);
    if (filters.difficulty) query = query.eq('difficulty', filters.difficulty);
    if (filters.approved !== undefined) query = query.eq('approved', filters.approved);
    if (filters.tos_id) query = query.eq('tos_id', filters.tos_id);
    if (filters.created_by) query = query.eq('created_by', filters.created_by);
    
    const { data, error } = await query.order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data;
  },

  async update(id: string, updates: any) {
    const { data, error } = await supabase
      .from('questions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async delete(id: string) {
    const { error } = await supabase
      .from('questions')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  },

  async toggleApproval(id: string, approved: boolean) {
    const { data, error } = await supabase
      .from('questions')
      .update({ approved })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async getUnapproved() {
    return this.search({ approved: false });
  }
};

// Tests Service
export const TestsService = {
  async create(payload: any) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    
    const insert = { 
      ...payload, 
      created_by: user.id,
      items: payload.items || {},
      answer_key: payload.answer_key || {}
    };
    const { data, error } = await supabase
      .from('generated_tests')
      .insert(insert)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async list() {
    const { data, error } = await supabase
      .from('generated_tests')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from('generated_tests')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data;
  },

  async addVersion(payload: any) {
    const { data, error } = await supabase
      .from('test_versions')
      .insert(payload)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async getVersions(testId: string) {
    const { data, error } = await supabase
      .from('test_versions')
      .select('*')
      .eq('test_metadata_id', testId)
      .order('version_label');
    
    if (error) throw error;
    return data || [];
  }
};

// Analytics Service
export const AnalyticsService = {
  async getQuestionStats() {
    // Get all questions for analysis
    const { data: questions, error } = await supabase
      .from('questions')
      .select('bloom_level, difficulty, topic, knowledge_dimension, approved')
      .eq('approved', true);
    
    if (error) throw error;
    
    const questionsData = questions || [];
    
    // Process the data
    const bloomCounts = this.countByField(questionsData, 'bloom_level');
    const difficultyCounts = this.countByField(questionsData, 'difficulty');
    const topicCounts = this.countByField(questionsData, 'topic');
    const knowledgeCounts = this.countByField(questionsData, 'knowledge_dimension');
    
    return { bloomCounts, difficultyCounts, topicCounts, knowledgeCounts };
  },

  countByField(data: any[], field: string) {
    const counts: Record<string, number> = {};
    data.forEach(item => {
      const value = item[field];
      if (value) {
        counts[value] = (counts[value] || 0) + 1;
      }
    });
    
    return Object.entries(counts).map(([key, count]) => ({
      [field]: key,
      count
    }));
  }
};

// Rubrics Service
export const RubricsService = {
  async create(payload: any) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    
    const insert = { ...payload, created_by: 'teacher' };
    const { data, error } = await supabase
      .from('rubrics')
      .insert(insert)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async list() {
    const { data, error } = await supabase
      .from('rubrics')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from('rubrics')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data;
  },

  async attachToQuestion(questionId: string, rubricId: string) {
    // Note: This requires the question_rubrics table to be created
    console.log('Attaching rubric to question:', { questionId, rubricId });
    // Implementation pending table creation
  }
};

// Storage Service for PDF exports
export const StorageService = {
  async uploadPDF(file: File | Blob, path: string): Promise<string> {
    const { data, error } = await supabase.storage
      .from('exports')
      .upload(path, file, { 
        upsert: true, 
        contentType: 'application/pdf' 
      });
    
    if (error) throw error;
    
    const { data: publicURL } = supabase.storage
      .from('exports')
      .getPublicUrl(path);
    
    return publicURL.publicUrl;
  },

  async deletePDF(path: string) {
    const { error } = await supabase.storage
      .from('exports')
      .remove([path]);
    
    if (error) throw error;
  }
};