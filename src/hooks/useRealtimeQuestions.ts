import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Question } from '@/lib/supabaseClient';

export function useRealtimeQuestions(initialQuestions: Question[] = []) {
  const [questions, setQuestions] = useState<Question[]>(initialQuestions);

  useEffect(() => {
    // Subscribe to real-time updates for questions table
    const channel = supabase
      .channel('questions-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'questions'
        },
        (payload) => {
          console.log('New question inserted:', payload.new);
          setQuestions(prev => [payload.new as Question, ...prev]);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'questions'
        },
        (payload) => {
          console.log('Question updated:', payload.new);
          setQuestions(prev => 
            prev.map(q => q.id === payload.new.id ? payload.new as Question : q)
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'questions'
        },
        (payload) => {
          console.log('Question deleted:', payload.old);
          setQuestions(prev => prev.filter(q => q.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return {
    questions,
    setQuestions
  };
}