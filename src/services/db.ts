import { supabase } from '@/lib/supabaseClient';

// Profile utilities
export async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  return data;
}

export async function updateProfile(updates: any) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  
  const { data, error } = await supabase.from('profiles').update(updates).eq('id', user.id).select().single();
  if (error) throw error;
  return data;
}

// TOS operations
export const TOS = {
  async create(payload: any) {
    const { data: { user } } = await supabase.auth.getUser();
    const insert = { ...payload, owner: user?.id };
    const { data, error } = await supabase.from('tos_entries').insert(insert).select().single();
    if (error) throw error;
    return data;
  },

  async listMine() {
    const { data, error } = await supabase.from('tos_entries').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getById(id: string) {
    const { data, error } = await supabase.from('tos_entries').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  async update(id: string, patch: any) {
    const { data, error } = await supabase.from('tos_entries').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async delete(id: string) {
    const { error } = await supabase.from('tos_entries').delete().eq('id', id);
    if (error) throw error;
  }
};

// Question operations
export const Questions = {
  async insertMany(rows: any[]) {
    const { data: { user } } = await supabase.auth.getUser();
    const withOwner = rows.map(r => ({ owner: user?.id, ...r }));
    
    const { data, error } = await supabase
      .from('questions')
      .insert(withOwner)
      .select();
    
    if (error) throw error;
    return data;
  },

  async search(filters: {
    topic?: string;
    bloom_level?: string;
    difficulty?: string;
    approved?: boolean;
    created_by?: string;
    needs_review?: boolean;
    tos_id?: string;
    search?: string;
  }) {
    let query = supabase.from('questions').select('*');
    
    if (filters.topic) query = query.eq('topic', filters.topic);
    if (filters.bloom_level) query = query.eq('bloom_level', filters.bloom_level);
    if (filters.difficulty) query = query.eq('difficulty', filters.difficulty);
    if (filters.approved !== undefined) query = query.eq('approved', filters.approved);
    if (filters.created_by) query = query.eq('created_by', filters.created_by);
    if (filters.needs_review !== undefined) query = query.eq('needs_review', filters.needs_review);
    if (filters.tos_id) query = query.eq('tos_id', filters.tos_id);
    if (filters.search) {
      query = query.or(`question_text.ilike.%${filters.search}%,topic.ilike.%${filters.search}%`);
    }
    
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async toggleApproval(id: string, approved: boolean, reason?: string) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('questions')
      .update({ 
        approved, 
        needs_review: !approved,
        approved_by: user?.email || 'system',
        approval_notes: reason,
        approval_confidence: approved ? 1.0 : 0.0,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async delete(id: string) {
    const { error } = await supabase.from('questions').delete().eq('id', id);
    if (error) throw error;
  },

  async getById(id: string) {
    const { data, error } = await supabase.from('questions').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  async incrementUsage(id: string) {
    const { error } = await supabase
      .from('questions')
      .update({ 
        used_count: supabase.sql`used_count + 1`,
        used_history: supabase.sql`used_history || ${JSON.stringify([new Date().toISOString()])}`
      })
      .eq('id', id);
    
    if (error) throw error;
  }
};

// Test operations
export const Tests = {
  async create(tos_id: string, title: string, params: any) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('generated_tests')
      .insert({ 
        owner: user?.id, 
        tos_id, 
        title, 
        params 
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async addVersion(test_id: string, label: string, question_ids: string[], answer_key: any, payload: any) {
    const { data, error } = await supabase
      .from('test_versions')
      .insert({ 
        test_id, 
        label, 
        question_ids, 
        answer_key, 
        payload 
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async getVersions(test_id: string) {
    const { data, error } = await supabase
      .from('test_versions')
      .select('*')
      .eq('test_id', test_id)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    return data;
  },

  async listMine() {
    const { data, error } = await supabase
      .from('generated_tests')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  }
};

// Rubric operations
export const Rubrics = {
  async create(name: string, criteria: any[]) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('rubrics')
      .insert({ 
        owner: user?.id, 
        name, 
        criteria 
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async listMine() {
    const { data, error } = await supabase
      .from('rubrics')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  async attachToQuestion(question_id: string, rubric_id: string) {
    const { data, error } = await supabase
      .from('question_rubrics')
      .upsert({ 
        question_id, 
        rubric_id 
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
};

// Analytics operations
export const Analytics = {
  async bloomCounts() {
    const { data, error } = await supabase
      .from('questions')
      .select('bloom_level')
      .eq('approved', true);
    
    if (error) throw error;
    
    const counts: Record<string, number> = {};
    data?.forEach(q => {
      counts[q.bloom_level] = (counts[q.bloom_level] || 0) + 1;
    });
    
    return Object.entries(counts).map(([bloom_level, count]) => ({ 
      bloom_level, 
      count 
    }));
  },

  async difficultyCounts() {
    const { data, error } = await supabase
      .from('questions')
      .select('difficulty')
      .eq('approved', true);
    
    if (error) throw error;
    
    const counts: Record<string, number> = {};
    data?.forEach(q => {
      counts[q.difficulty] = (counts[q.difficulty] || 0) + 1;
    });
    
    return Object.entries(counts).map(([difficulty, count]) => ({ 
      difficulty, 
      count 
    }));
  },

  async activityTimeline() {
    const { data, error } = await supabase
      .from('activities')
      .select('*')
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    return data;
  },

  creatorStats: async () => {
    const { data, error } = await supabase
      .from('questions')
      .select('created_by')
      .then(({ data, error }) => {
        if (error) throw error;
        const counts = data?.reduce((acc: any, item: any) => {
          acc[item.created_by] = (acc[item.created_by] || 0) + 1;
          return acc;
        }, {}) || {};
        return Object.entries(counts).map(([created_by, count]) => ({ created_by, count }));
      });
    return data;
  },
  
  approvalStats: async () => {
    const { data, error } = await supabase
      .from('questions') 
      .select('approved')
      .then(({ data, error }) => {
        if (error) throw error;
        const counts = data?.reduce((acc: any, item: any) => {
          acc[item.approved] = (acc[item.approved] || 0) + 1;
          return acc;
        }, {}) || {};
        return Object.entries(counts).map(([approved, count]) => ({ approved, count }));
      });
    return data;
  },
  
  topicCounts: async () => {
    const { data, error } = await supabase
      .from('questions')
      .select('topic')
      .then(({ data, error }) => {
        if (error) throw error;
        const counts = data?.reduce((acc: any, item: any) => {
          acc[item.topic] = (acc[item.topic] || 0) + 1;
          return acc;
        }, {}) || {};
        return Object.entries(counts).map(([topic, count]) => ({ topic, count }));
      });
    return data;
  }
};

// Activity logging
export const ActivityLog = {
  async log(type: string, meta: any = {}) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('activities')
      .insert({ 
        actor: user?.id, 
        type, 
        meta 
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
};

// Bulk import operations
export const BulkImports = {
  async create(filename: string, summary: any) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('bulk_imports')
      .insert({ 
        owner: user?.id, 
        filename, 
        summary,
        status: 'processing'
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async updateStatus(id: string, status: string, summary?: any) {
    const updates: any = { status };
    if (summary) updates.summary = summary;
    
    const { data, error } = await supabase
      .from('bulk_imports')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
};