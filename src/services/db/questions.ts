import { supabase } from "@/integrations/supabase/client";

export interface Question {
  id?: string;
  tos_id?: string;
  topic: string;
  question_text: string;
  question_type: 'mcq' | 'essay' | 'true_false' | 'short_answer';
  choices?: Record<string, string>;
  correct_answer?: string;
  bloom_level: string;
  difficulty: string;
  knowledge_dimension?: string;
  created_by: 'teacher' | 'ai' | 'bulk_import';
  approved: boolean;
  ai_confidence_score?: number;
  needs_review: boolean;
  used_count?: number;
  used_history?: any[];
  metadata?: any;
  deleted?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface QuestionFilters {
  approved?: boolean;
  topic?: string;
  bloom_level?: string;
  difficulty?: string;
  search?: string;
  created_by?: string;
  needs_review?: boolean;
  tos_id?: string;
}

export const Questions = {
  async insert(payload: Omit<Question, 'id' | 'created_at' | 'updated_at'>) {
    const { data, error } = await supabase
      .from("questions")
      .insert(payload)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async bulkInsert(questions: Array<Omit<Question, 'id' | 'created_at' | 'updated_at'>>) {
    const { data, error } = await supabase
      .from("questions")
      .insert(questions)
      .select();
    
    if (error) throw error;
    return data ?? [];
  },

  async update(id: string, patch: Partial<Question>) {
    const { data, error } = await supabase
      .from("questions")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async delete(id: string) {
    const { error } = await supabase
      .from("questions")
      .update({ deleted: true })
      .eq("id", id);
    
    if (error) throw error;
  },

  async toggleApproval(id: string, approved: boolean, reason?: string) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("questions")
      .update({ 
        approved, 
        needs_review: !approved,
        approved_by: user?.email || 'system',
        approval_notes: reason,
        approval_confidence: approved ? 1.0 : 0.0,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select()
      .single();
    
    if (error) throw error;

    // Log the activity
    await supabase.from("activity_log").insert({
      user_id: user?.id,
      action: approved ? 'approve_question' : 'revoke_approval',
      entity_type: 'question',
      entity_id: id,
      meta: { reason }
    });

    return data;
  },

  async search(filters: QuestionFilters) {
    let query = supabase
      .from("questions")
      .select("*")
      .eq("deleted", false);

    if (filters.approved !== undefined) {
      query = query.eq("approved", filters.approved);
    }
    if (filters.topic) {
      query = query.eq("topic", filters.topic);
    }
    if (filters.bloom_level) {
      query = query.eq("bloom_level", filters.bloom_level.toLowerCase());
    }
    if (filters.difficulty) {
      query = query.eq("difficulty", filters.difficulty.toLowerCase());
    }
    if (filters.created_by) {
      query = query.eq("created_by", filters.created_by);
    }
    if (filters.needs_review !== undefined) {
      query = query.eq("needs_review", filters.needs_review);
    }
    if (filters.tos_id) {
      query = query.eq("tos_id", filters.tos_id);
    }
    if (filters.search) {
      query = query.or(`question_text.ilike.%${filters.search}%,topic.ilike.%${filters.search}%`);
    }

    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .eq("id", id)
      .eq("deleted", false)
      .single();
    
    if (error) throw error;
    return data;
  },

  async incrementUsage(id: string) {
    const { error } = await supabase
      .from("questions")
      .update({ 
        used_count: supabase.sql`used_count + 1`,
        used_history: supabase.sql`used_history || ${JSON.stringify([new Date().toISOString()])}`
      })
      .eq("id", id);
    
    if (error) throw error;
  },

  async getTopics() {
    const { data, error } = await supabase
      .from("questions")
      .select("topic")
      .eq("deleted", false);
    
    if (error) throw error;
    
    const topics = [...new Set((data ?? []).map(q => q.topic))];
    return topics.sort();
  },

  async getStats() {
    const { data, error } = await supabase
      .from("questions")
      .select("approved, created_by, needs_review")
      .eq("deleted", false);
    
    if (error) throw error;
    
    const questions = data ?? [];
    return {
      total: questions.length,
      approved: questions.filter(q => q.approved).length,
      pending: questions.filter(q => !q.approved).length,
      ai_generated: questions.filter(q => q.created_by === 'ai' || q.created_by === 'bulk_import').length,
      teacher_created: questions.filter(q => q.created_by === 'teacher').length,
      needs_review: questions.filter(q => q.needs_review).length
    };
  }
};