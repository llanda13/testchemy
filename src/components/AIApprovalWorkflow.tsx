import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  CheckCircle, 
  XCircle, 
  Brain, 
  Clock, 
  AlertTriangle, 
  Sparkles,
  TrendingUp,
  Search,
  RefreshCw
} from "lucide-react";
import { toast } from "sonner";
import { Questions } from "@/services/db/questions";
import { useRealtimeQuestions } from "@/hooks/useRealtimeQuestions";
import { useRealtime } from "@/hooks/useRealtime";
import { usePresence } from "@/hooks/usePresence";
import { useState } from "react";


interface AIApprovalWorkflowProps {
  onBack: () => void;
}

export const AIApprovalWorkflow = ({ onBack }: AIApprovalWorkflowProps) => {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [filterConfidence, setFilterConfidence] = useState<string>("all");
  const [filterTopic, setFilterTopic] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [batchMode, setBatchMode] = useState(false);
  const [selectedQuestions, setSelectedQuestions] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<number>(0);
  const [setRejectionReasons] = useState<Record<string, string>>({});

  // Real-time collaboration for approval workflow
  const { users: reviewers, isConnected } = usePresence('ai-approval', {
    name: 'Admin User', // Should come from auth context
    email: 'admin@example.com' // Should come from auth context
  });

  // Real-time updates for question approvals
  useRealtime('approval-workflow', {
    table: 'questions',
    filter: 'approved=eq.false',
    onUpdate: (updatedQuestion) => {
      if (updatedQuestion.approved) {
        toast.success(`Question approved by ${updatedQuestion.approved_by || 'another admin'}`);
        // Remove from local state or refresh
      }
    },
    onInsert: (newQuestion) => {
      if (newQuestion.created_by === 'ai' || newQuestion.needs_review) {
        toast.info('New AI question added to review queue');
        setPendingApprovals(prev => prev + 1);
      }
    }
  });

  // Use realtime questions hook with filter for unapproved AI/bulk questions
  const { questions: pendingQuestions, stats, loading, actions } = useRealtimeQuestions({
    approved: false
  });

  // Filter for AI-generated or bulk imported questions
  const aiQuestions = pendingQuestions.filter(q => 
    q.created_by === 'ai' || 
    q.created_by === 'bulk_import' || 
    q.needs_review
  );
  const handleApproveQuestion = async (questionId: string) => {
    setProcessingId(questionId);
    try {
      const notes = rejectionReasons[questionId] || "Approved by admin review";
      
      await actions.toggleApproval(questionId, true, notes);

      // Log approval activity
      await supabase.from("activity_log").insert({
        action: 'approve_question',
        entity_type: 'question', 
        entity_id: questionId,
        meta: { 
          reason: notes,
          confidence_before: questions.find(q => q.id === questionId)?.ai_confidence_score 
        }
      });

      toast.success("Question approved and added to the question bank");
      
      setRejectionReasons(prev => {
        const newReasons = { ...prev };
        delete newReasons[questionId];
        return newReasons;
      });
    } catch (error) {
      console.error('Error approving question:', error);
      toast.error("Failed to approve question");
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectQuestion = async (questionId: string) => {
    setProcessingId(questionId);
    try {
      const notes = rejectionReasons[questionId] || "Question rejected during admin review";
      
      // Log rejection before deletion
      await supabase.from("activity_log").insert({
        action: 'reject_question',
        entity_type: 'question',
        entity_id: questionId,
        meta: { 
          reason: notes,
          question_text: questions.find(q => q.id === questionId)?.question_text?.substring(0, 100)
        }
      });
      
      await actions.deleteQuestion(questionId);

      toast.success("Question rejected and removed from the system");

      setRejectionReasons(prev => {
        const newReasons = { ...prev };
        delete newReasons[questionId];
        return newReasons;
      });
    } catch (error) {
      console.error('Error rejecting question:', error);
      toast.error("Failed to reject question");
    } finally {
      setProcessingId(null);
    }
  };

  const handleBatchApprove = async () => {
    if (selectedQuestions.size === 0) {
      toast.error("Please select questions to approve");
      return;
    }

    setIsProcessing(true);
    try {
      let successCount = 0;
      let errorCount = 0;
      
      const promises = Array.from(selectedQuestions).map(questionId =>
        actions.toggleApproval(questionId, true, "Batch approved by admin")
          .then(() => successCount++)
          .catch(() => errorCount++)
      );
      
      await Promise.allSettled(promises);

      if (successCount > 0) {
        toast.success(`Approved ${successCount} questions`);
      }
      if (errorCount > 0) {
        toast.error(`Failed to approve ${errorCount} questions`);
      }
      
      setSelectedQuestions(new Set());
    } catch (error) {
      console.error('Error in batch approval:', error);
      toast.error("Failed to approve some questions");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBatchReject = async () => {
    if (selectedQuestions.size === 0) {
      toast.error("Please select questions to reject");
      return;
    }

    setIsProcessing(true);
    try {
      let successCount = 0;
      let errorCount = 0;
      
      const promises = Array.from(selectedQuestions).map(questionId =>
        actions.deleteQuestion(questionId)
          .then(() => successCount++)
          .catch(() => errorCount++)
      );
      
      await Promise.allSettled(promises);

      if (successCount > 0) {
        toast.success(`Rejected ${successCount} questions`);
      }
      if (errorCount > 0) {
        toast.error(`Failed to reject ${errorCount} questions`);
      }
      
      setSelectedQuestions(new Set());
    } catch (error) {
      console.error('Error in batch rejection:', error);
      toast.error("Failed to reject some questions");
    } finally {
      setIsProcessing(false);
    }
  };

  // Get unique topics for filtering
  const topics = [...new Set(aiQuestions.map(q => q.topic))];

  const filteredQuestions = aiQuestions.filter(question => {
    const confidence = question.ai_confidence_score || 0;
    
    const matchesConfidence = filterConfidence === "all" || 
      (filterConfidence === "high" && confidence >= 0.8) ||
      (filterConfidence === "medium" && confidence >= 0.6 && confidence < 0.8) ||
      (filterConfidence === "low" && confidence < 0.6);
    
    const matchesTopic = filterTopic === "all" || question.topic === filterTopic;
    const matchesSearch = searchTerm === "" || 
      question.question_text.toLowerCase().includes(searchTerm.toLowerCase()) ||
      question.topic.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesConfidence && matchesTopic && matchesSearch;
  });

  const getConfidenceColor = (score?: number) => {
    if (!score) return "text-muted-foreground";
    if (score >= 0.8) return "text-green-600";
    if (score >= 0.6) return "text-yellow-600";
    return "text-red-600";
  };

  const getConfidenceLabel = (score?: number) => {
    if (!score) return "Unknown";
    if (score >= 0.8) return "High";
    if (score >= 0.6) return "Medium";
    return "Low";
  };

  const formatQuestionType = (type: string) => {
    switch (type) {
      case 'mcq':
        return 'Multiple Choice';
      case 'true_false':
        return 'True/False';
      case 'essay':
        return 'Essay';
      case 'short_answer':
        return 'Short Answer';
      default:
        return type;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container-custom section-padding">
        {/* Header */}
        <div className="text-center mb-16 animate-slide-in-down">
          <div className="inline-flex items-center gap-2 bg-primary/10 backdrop-blur-sm rounded-full px-6 py-3 mb-6">
            <Brain className="w-5 h-5 text-primary" />
            <span className="text-primary font-medium">AI Question Review</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-foreground mb-4">
            AI Approval <span className="text-shimmer">Workflow</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            Review and approve AI-generated questions before they're added to the question bank
          </p>
          <Button variant="outline" onClick={onBack} className="interactive focus-ring">
            ← Back to Dashboard
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12 animate-slide-in-up stagger-1">
          <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20 card-hover">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-primary/20 rounded-xl">
                  <Clock className="w-6 h-6 text-primary" />
                </div>
              </div>
              <div className="text-3xl font-bold text-primary mb-1">
                {aiQuestions.length}
              </div>
              <div className="text-sm text-muted-foreground">Pending Review</div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-500/5 to-green-500/10 border-green-500/20 card-hover">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-green-500/20 rounded-xl">
                  <TrendingUp className="w-6 h-6 text-green-500" />
                </div>
              </div>
              <div className="text-3xl font-bold text-green-500 mb-1">
                {aiQuestions.filter(q => (q.ai_confidence_score || 0) >= 0.8).length}
              </div>
              <div className="text-sm text-muted-foreground">High Confidence</div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-yellow-500/5 to-yellow-500/10 border-yellow-500/20 card-hover">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-yellow-500/20 rounded-xl">
                  <AlertTriangle className="w-6 h-6 text-yellow-500" />
                </div>
              </div>
              <div className="text-3xl font-bold text-yellow-500 mb-1">
                {aiQuestions.filter(q => (q.ai_confidence_score || 0) < 0.6).length}
              </div>
              <div className="text-sm text-muted-foreground">Needs Attention</div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-secondary/5 to-secondary/10 border-secondary/20 card-hover">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-secondary/20 rounded-xl">
                  <Sparkles className="w-6 h-6 text-secondary" />
                </div>
              </div>
              <div className="text-3xl font-bold text-secondary mb-1">
                {aiQuestions.length > 0 
                  ? ((aiQuestions.reduce((sum, q) => sum + (q.ai_confidence_score || 0), 0) / aiQuestions.length) * 100).toFixed(0)
                  : 0}%
              </div>
              <div className="text-sm text-muted-foreground">Avg. Confidence</div>
            </CardContent>
          </Card>
        </div>

        {/* Filter Bar */}
        <Card className="bg-card/80 backdrop-blur-sm border border-border/50 shadow-card mb-8 animate-slide-in-up stagger-2">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search questions..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              
              <Select value={filterConfidence} onValueChange={setFilterConfidence}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by confidence" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Confidence Levels</SelectItem>
                  <SelectItem value="high">High (≥80%)</SelectItem>
                  <SelectItem value="medium">Medium (60-79%)</SelectItem>
                  <SelectItem value="low">Low (&lt;60%)</SelectItem>
                </SelectContent>
              </Select>
              
              <Select value={filterTopic} onValueChange={setFilterTopic}>
                <SelectTrigger>
                  <SelectValue placeholder="All Topics" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Topics</SelectItem>
                  {topics.map((topic) => (
                    <SelectItem key={topic} value={topic}>{topic}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Button
                variant="outline"
                onClick={() => {
                  setSearchTerm("");
                  setFilterConfidence("all");
                  setFilterTopic("all");
                }}
              >
                Clear Filters
              </Button>
              
              <Button
                variant="outline"
                onClick={() => setBatchMode(!batchMode)}
              >
                {batchMode ? "Exit Batch Mode" : "Batch Mode"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Batch Actions */}
        {batchMode && (
          <Card className="bg-card/80 backdrop-blur-sm border border-border/50 shadow-card mb-8">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium">
                    {selectedQuestions.size} questions selected
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (selectedQuestions.size === filteredQuestions.length) {
                        setSelectedQuestions(new Set());
                      } else {
                        setSelectedQuestions(new Set(filteredQuestions.map(q => q.id)));
                      }
                    }}
                  >
                    {selectedQuestions.size === filteredQuestions.length ? "Deselect All" : "Select All"}
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleBatchApprove}
                    disabled={selectedQuestions.size === 0 || isProcessing}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Approve Selected
                  </Button>
                  <Button
                    onClick={handleBatchReject}
                    disabled={selectedQuestions.size === 0 || isProcessing}
                    variant="destructive"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Reject Selected
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Questions List */}
        <div className="space-y-6 animate-slide-in-up stagger-3">
          {loading ? (
            <Card className="bg-card/80 backdrop-blur-sm border border-border/50">
              <CardContent className="p-12 text-center">
                <Brain className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-50 animate-spin" />
                <p className="text-muted-foreground">Loading questions for review...</p>
              </CardContent>
            </Card>
          ) : filteredQuestions.length === 0 ? (
            <Card className="bg-card/80 backdrop-blur-sm border border-border/50 animate-fade-in-scale">
              <CardContent className="p-12 text-center">
                <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  {aiQuestions.length === 0 ? "All caught up!" : "No questions match your filter"}
                </h3>
                <p className="text-muted-foreground">
                  {aiQuestions.length === 0 
                    ? "There are no AI-generated questions pending review."
                    : "Try adjusting your confidence filter to see more questions."
                  }
                </p>
                {aiQuestions.length === 0 && (
                  <Button
                    variant="outline"
                    onClick={actions.refresh}
                    className="mt-4"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Refresh
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            filteredQuestions.map((question) => (
              <Card key={question.id} className="bg-card/80 backdrop-blur-sm border border-border/50 card-hover">
                <CardHeader className="border-b border-border/50">
                  <div className="flex justify-between items-start">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {batchMode && (
                          <Checkbox
                            checked={selectedQuestions.has(question.id)}
                            onCheckedChange={(checked) => {
                              const newSelected = new Set(selectedQuestions);
                              if (checked) {
                                newSelected.add(question.id!);
                              } else {
                                newSelected.delete(question.id!);
                              }
                              setSelectedQuestions(newSelected);
                            }}
                          />
                        )}
                        <Brain className="w-4 h-4 text-primary" />
                        <span className="text-sm text-muted-foreground">AI Generated Question</span>
                        {question.ai_confidence_score && (
                          <Badge 
                            variant="outline" 
                            className={`${getConfidenceColor(question.ai_confidence_score)} border-current`}
                          >
                            {getConfidenceLabel(question.ai_confidence_score)} Confidence
                          </Badge>
                        )}
                        <Badge variant="secondary">
                          {question.created_by === 'bulk_import' ? 'Bulk Import' : 'AI Generated'}
                        </Badge>
                      </div>
                      <CardTitle className="text-lg">{question.question_text}</CardTitle>
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      {new Date(question.created_at!).toLocaleDateString()}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-6">
                  {/* Question Details */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <span className="text-sm text-muted-foreground">Type</span>
                      <p className="font-medium">{formatQuestionType(question.question_type)}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Topic</span>
                      <p className="font-medium">{question.topic}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Bloom Level</span>
                      <p className="font-medium">{question.bloom_level}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Difficulty</span>
                      <p className="font-medium">{question.difficulty}</p>
                    </div>
                    <div className="md:col-span-4">
                      <span className="text-sm text-muted-foreground">Knowledge Dimension</span>
                      <p className="font-medium">{question.knowledge_dimension || 'Not specified'}</p>
                    </div>
                  </div>

                  {/* Answer Choices */}
                  {question.choices && (
                    <div>
                      <span className="text-sm text-muted-foreground mb-2 block">Answer Choices</span>
                      <div className="space-y-2">
                        {Object.entries(question.choices).map(([key, value]) => (
                          <div key={key} className="flex items-center gap-2">
                            <span className="text-sm font-medium text-muted-foreground min-w-[20px]">
                              {key.toUpperCase()}.
                            </span>
                            <span className={`text-sm ${question.correct_answer === key ? 'font-medium text-green-600' : ''}`}>
                              {value as string}
                              {question.correct_answer === key && <span className="ml-2">✓</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AI Confidence Score */}
                  {question.ai_confidence_score && (
                    <div>
                      <span className="text-sm text-muted-foreground mb-2 block">AI Confidence Score</span>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-muted rounded-full h-2">
                          <div 
                            className="h-2 rounded-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500"
                            style={{ width: `${question.ai_confidence_score * 100}%` }}
                          />
                        </div>
                        <span className={`text-sm font-medium ${getConfidenceColor(question.ai_confidence_score)}`}>
                          {(question.ai_confidence_score * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Rejection Reason Input */}
                  <div>
                    <span className="text-sm text-muted-foreground mb-2 block">Admin Notes (Optional)</span>
                    <Textarea
                      placeholder="Add notes about this question or reason for rejection..."
                      value={rejectionReasons[question.id!] || ""}
                      onChange={(e) => setRejectionReason(prev => ({
                        ...prev,
                        [question.id!]: e.target.value
                      }))}
                      className="min-h-[80px]"
                    />
                  </div>

                  {/* Action Buttons */}
                  {!batchMode && (
                    <div className="flex gap-3 pt-4 border-t border-border/50">
                      <Button
                        onClick={() => handleApproveQuestion(question.id!)}
                        disabled={processingId === question.id}
                        className="bg-green-600 hover:bg-green-700 text-white flex-1"
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        {processingId === question.id ? 'Approving...' : 'Approve Question'}
                      </Button>
                      <Button
                        onClick={() => handleRejectQuestion(question.id!)}
                        disabled={processingId === question.id}
                        variant="destructive"
                        className="flex-1"
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        {processingId === question.id ? 'Rejecting...' : 'Reject Question'}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
};