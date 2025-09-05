import { supabase } from "@/integrations/supabase/client";

export interface GeneratedTest {
  id: string;
  title: string;
  subject: string;
  course?: string;
  year_section?: string;
  exam_period?: string;
  school_year?: string;
  instructions?: string;
  tos_id?: string;
  time_limit?: number;
  points_per_question?: number;
  num_versions: number;
  versions: any[];
  answer_keys: any[];
  shuffle_questions?: boolean;
  shuffle_choices?: boolean;
  created_by?: string;
  created_at?: string;
}

export const GeneratedTests = {
  async create(payload: Omit<GeneratedTest, 'id' | 'created_at'>) {
    const { data: { user } } = await supabase.auth.getUser();
    const testData = {
      ...payload,
      created_by: user?.id
    };
    
    const { data, error } = await supabase
      .from("generated_tests")
      .insert(testData)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from("generated_tests")
      .select("*")
      .eq("id", id)
      .single();
    
    if (error) throw error;
    return data;
  },

  async list() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("generated_tests")
      .select("*")
      .eq("created_by", user?.id)
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    return data ?? [];
  },

  async update(id: string, patch: Partial<GeneratedTest>) {
    const { data, error } = await supabase
      .from("generated_tests")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async delete(id: string) {
    const { error } = await supabase
      .from("generated_tests")
      .delete()
      .eq("id", id);
    
    if (error) throw error;
  }
};