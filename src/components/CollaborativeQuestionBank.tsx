import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Edit2, Trash2, Save, X } from 'lucide-react';
import { useCollaborativeEditing } from '@/hooks/useCollaborativeEditing';
import { CollaborationIndicator } from './CollaborationIndicator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Question {
  id?: string;
  question_text: string;
  question_type: string;
  choices?: any;
  correct_answer?: string;
  bloom_level: string;
  difficulty: string;
  topic: string;
  knowledge_dimension: string;
}

export const CollaborativeQuestionBank: React.FC = () => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const documentId = 'question-bank-shared';
  
  const {
    users,
    isConnected,
    currentUser,
    broadcastChange
  } = useCollaborativeEditing({
    documentId,
    documentType: 'question',
    initialData: { questions },
    onDataChange: (data) => {
      if (data.questions) {
        setQuestions(data.questions);
      }
    }
  });

  useEffect(() => {
    loadQuestions();
  }, []);

  const loadQuestions = async () => {
    try {
      const { data, error } = await supabase
        .from('questions')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setQuestions(data || []);
      broadcastChange({ questions: data || [] });
    } catch (error) {
      console.error('Error loading questions:', error);
      toast.error('Failed to load questions');
    } finally {
      setLoading(false);
    }
  };

  const saveQuestion = async (question: Question) => {
    try {
      if (question.id) {
        // Update existing question
        const { error } = await supabase
          .from('questions')
          .update(question)
          .eq('id', question.id);
        
        if (error) throw error;
        
        const updatedQuestions = questions.map(q => 
          q.id === question.id ? question : q
        );
        setQuestions(updatedQuestions);
        broadcastChange({ questions: updatedQuestions });
        toast.success('Question updated successfully');
      } else {
        // Create new question
        const { data, error } = await supabase
          .from('questions')
          .insert([question])
          .select()
          .single();
        
        if (error) throw error;
        
        const updatedQuestions = [data, ...questions];
        setQuestions(updatedQuestions);
        broadcastChange({ questions: updatedQuestions });
        toast.success('Question created successfully');
      }
    } catch (error) {
      console.error('Error saving question:', error);
      toast.error('Failed to save question');
    }
  };

  const deleteQuestion = async (questionId: string) => {
    try {
      const { error } = await supabase
        .from('questions')
        .delete()
        .eq('id', questionId);
      
      if (error) throw error;
      
      const updatedQuestions = questions.filter(q => q.id !== questionId);
      setQuestions(updatedQuestions);
      broadcastChange({ questions: updatedQuestions });
      toast.success('Question deleted successfully');
    } catch (error) {
      console.error('Error deleting question:', error);
      toast.error('Failed to delete question');
    }
  };

  const startEditing = (question: Question) => {
    setEditingQuestion({ ...question });
    setIsCreating(false);
  };

  const startCreating = () => {
    setEditingQuestion({
      question_text: '',
      question_type: 'multiple_choice',
      choices: ['', '', '', ''],
      correct_answer: '',
      bloom_level: 'remembering',
      difficulty: 'easy',
      topic: '',
      knowledge_dimension: 'factual'
    });
    setIsCreating(true);
  };

  const cancelEditing = () => {
    setEditingQuestion(null);
    setIsCreating(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQuestion) return;

    await saveQuestion(editingQuestion);
    cancelEditing();
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Collaborative Question Bank</span>
            <div className="flex items-center gap-4">
              <CollaborationIndicator 
                users={users}
                isConnected={isConnected}
                currentUser={currentUser}
              />
              <Button onClick={startCreating} disabled={isCreating || editingQuestion !== null}>
                <Plus className="h-4 w-4 mr-2" />
                Add Question
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(isCreating || editingQuestion) && (
            <Card className="mb-6 border-2 border-primary">
              <CardHeader>
                <CardTitle className="text-lg">
                  {isCreating ? 'Create New Question' : 'Edit Question'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">Topic</label>
                      <Input
                        value={editingQuestion?.topic || ''}
                        onChange={(e) => setEditingQuestion(prev => 
                          prev ? { ...prev, topic: e.target.value } : null
                        )}
                        placeholder="Enter topic"
                        required
                      />
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium">Question Type</label>
                      <Select
                        value={editingQuestion?.question_type || 'multiple_choice'}
                        onValueChange={(value) => setEditingQuestion(prev => 
                          prev ? { ...prev, question_type: value as any } : null
                        )}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
                          <SelectItem value="true_false">True/False</SelectItem>
                          <SelectItem value="essay">Essay</SelectItem>
                          <SelectItem value="short_answer">Short Answer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="text-sm font-medium">Bloom's Level</label>
                      <Select
                        value={editingQuestion?.bloom_level || 'remembering'}
                        onValueChange={(value) => setEditingQuestion(prev => 
                          prev ? { ...prev, bloom_level: value } : null
                        )}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="remembering">Remembering</SelectItem>
                          <SelectItem value="understanding">Understanding</SelectItem>
                          <SelectItem value="applying">Applying</SelectItem>
                          <SelectItem value="analyzing">Analyzing</SelectItem>
                          <SelectItem value="evaluating">Evaluating</SelectItem>
                          <SelectItem value="creating">Creating</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="text-sm font-medium">Difficulty</label>
                      <Select
                        value={editingQuestion?.difficulty || 'easy'}
                        onValueChange={(value) => setEditingQuestion(prev => 
                          prev ? { ...prev, difficulty: value } : null
                        )}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="easy">Easy</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="hard">Hard</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium">Question Text</label>
                    <Textarea
                      value={editingQuestion?.question_text || ''}
                      onChange={(e) => setEditingQuestion(prev => 
                        prev ? { ...prev, question_text: e.target.value } : null
                      )}
                      placeholder="Enter your question"
                      rows={3}
                      required
                    />
                  </div>

                  {editingQuestion?.question_type === 'multiple_choice' && (
                    <div>
                      <label className="text-sm font-medium">Choices</label>
                      <div className="space-y-2">
                        {editingQuestion.choices?.map((choice, index) => (
                          <Input
                            key={index}
                            value={choice}
                            onChange={(e) => {
                              const newChoices = [...(editingQuestion.choices || [])];
                              newChoices[index] = e.target.value;
                              setEditingQuestion(prev => 
                                prev ? { ...prev, choices: newChoices } : null
                              );
                            }}
                            placeholder={`Choice ${index + 1}`}
                          />
                        ))}
                      </div>
                      
                      <div className="mt-2">
                        <label className="text-sm font-medium">Correct Answer</label>
                        <Input
                          value={editingQuestion?.correct_answer || ''}
                          onChange={(e) => setEditingQuestion(prev => 
                            prev ? { ...prev, correct_answer: e.target.value } : null
                          )}
                          placeholder="Enter correct answer"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button type="submit">
                      <Save className="h-4 w-4 mr-2" />
                      Save Question
                    </Button>
                    <Button type="button" variant="outline" onClick={cancelEditing}>
                      <X className="h-4 w-4 mr-2" />
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <div className="space-y-4">
            {questions.map((question) => (
              <Card key={question.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-4">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{question.bloom_level}</Badge>
                      <Badge variant="outline">{question.difficulty}</Badge>
                      <Badge>{question.question_type}</Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEditing(question)}
                        disabled={editingQuestion !== null || isCreating}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => question.id && deleteQuestion(question.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <p className="font-medium">{question.topic}</p>
                    <p className="text-muted-foreground">{question.question_text}</p>
                    
                    {question.question_type === 'multiple_choice' && question.choices && (
                      <div className="ml-4 space-y-1">
                        {question.choices.map((choice, index) => (
                          <p key={index} className="text-sm">
                            {String.fromCharCode(65 + index)}. {choice}
                          </p>
                        ))}
                        {question.correct_answer && (
                          <p className="text-sm font-medium text-green-600">
                            Correct: {question.correct_answer}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}

            {questions.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p>No questions found. Start by creating your first question!</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};