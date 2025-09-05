import { supabase } from "@/integrations/supabase/client";

export interface TOSEntry {
  id?: string;
  subject_no: string;
  course: string;
  description: string;
  year_section: string;
  period: string;
  school_year: string;
  total_items: number;
  topics: Array<{ name: string; hours: number }>;
  bloom_distribution: Record<string, number>;
  matrix: Record<string, Record<string, { count: number; items: number[] }>>;
  prepared_by?: string;
  noted_by?: string;
  created_by?: string;
  created_at?: string;
}

export const TOS = {
  async create(payload: Omit<TOSEntry, 'id' | 'created_at'>) {
    const { data: { user } } = await supabase.auth.getUser();
    const tosData = {
      ...payload,
      created_by: user?.id
    };
    
    const { data, error } = await supabase
      .from("tos")
      .insert(tosData)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from("tos")
      .select("*")
      .eq("id", id)
      .single();
    
    if (error) throw error;
    return data;
  },

  async list() {
    const { data, error } = await supabase
      .from("tos")
      .select("*")
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    return data ?? [];
  },

  async update(id: string, patch: Partial<TOSEntry>) {
    const { data, error } = await supabase
      .from("tos")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async delete(id: string) {
    const { error } = await supabase
      .from("tos")
      .delete()
      .eq("id", id);
    
    if (error) throw error;
  },

  async getMatrix(id: string) {
    const { data, error } = await supabase
      .from("tos")
      .select("matrix, bloom_distribution, topics")
      .eq("id", id)
      .single();
    
    if (error) throw error;
    return data;
  }
};