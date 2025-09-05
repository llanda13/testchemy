import { supabase } from "@/integrations/supabase/client";

export interface RubricCriterion {
  key: string;
  name: string;
  description: string;
  max_points: number;
}

export interface Rubric {
  id?: string;
  name: string;
  question_id?: string;
  criteria: RubricCriterion[];
  total_max: number;
  created_by?: string;
  created_at?: string;
}

export interface RubricScore {
  id?: string;
  question_id: string;
  student_id?: string;
  student_name?: string;
  scores: Record<string, number>; // {clarity: 4, relevance: 5, mechanics: 3}
  total: number;
  comments?: string;
  graded_by?: string;
  created_at?: string;
}

export const Rubrics = {
  async create(name: string, criteria: any[]) {
    const { data: { user } } = await supabase.auth.getUser();
    const rubricData = {
      name,
      criteria,
      total_max: criteria.reduce((sum, c) => sum + c.max_points, 0),
      created_by: user?.id
    };
    
    const { data, error } = await supabase
      .from("rubrics")
      .insert(rubricData)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from("rubrics")
      .select("*")
      .eq("id", id)
      .single();
    
    if (error) throw error;
    return data;
  },

  async getByQuestion(questionId: string) {
    const { data, error } = await supabase
      .from("rubrics")
      .select("*")
      .eq("question_id", questionId)
      .maybeSingle();
    
    if (error) throw error;
    return data;
  },

  async list() {
    const { data, error } = await supabase
      .from("rubrics")
      .select("*")
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    return data ?? [];
  },

  async listAll() {
    return this.list();
  },

  async listMine() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("rubrics")
      .select("*")
      .eq("created_by", user?.id)
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    return data ?? [];
  },

  async getForQuestion(questionId: string) {
    return this.getByQuestion(questionId);
  },

  async attachToQuestion(questionId: string, rubricId: string) {
    return this.update(rubricId, { question_id: questionId });
  },

  async update(id: string, patch: Partial<Rubric>) {
    const { data, error } = await supabase
      .from("rubrics")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async delete(id: string) {
    const { error } = await supabase
      .from("rubrics")
      .delete()
      .eq("id", id);
    
    if (error) throw error;
  },

  async saveScore(payload: Omit<RubricScore, 'id' | 'created_at'>) {
    const { data: { user } } = await supabase.auth.getUser();
    const scoreData = {
      ...payload,
      graded_by: user?.id
    };
    
    const { data, error } = await supabase
      .from("rubric_scores")
      .insert(scoreData)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async getScores(questionId: string) {
    const { data, error } = await supabase
      .from("rubric_scores")
      .select("*")
      .eq("question_id", questionId)
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    return data ?? [];
  },

  async getScoresByStudent(studentId: string) {
    const { data, error } = await supabase
      .from("rubric_scores")
      .select("*")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    return data ?? [];
  },

  async updateScore(id: string, patch: Partial<RubricScore>) {
    const { data, error } = await supabase
      .from("rubric_scores")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
};