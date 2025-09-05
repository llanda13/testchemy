import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
  X,
  Download,
  Brain,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Questions } from '@/services/db/questions';
import { classifyQuestion, batchClassify } from '@/services/ai/classify';
import { classifyQuestions } from '@/services/edgeFunctions';

interface BulkImportProps {
  onClose: () => void;
  onImportComplete: () => void;
}

interface ParsedQuestion {
  topic: string;
  question_text: string;
  question_type: 'mcq' | 'true_false' | 'essay' | 'short_answer';
  choices?: Record<string, string>;
  correct_answer?: string;
  bloom_level?: string;
  difficulty?: string;
  knowledge_dimension?: string;
  created_by: 'bulk_import';
  approved: boolean;
  needs_review: boolean;
  ai_confidence_score?: number;
}

interface ImportStats {
  total: number;
  processed: number;
  approved: number;
  needsReview: number;
  byBloom: Record<string, number>;
  byDifficulty: Record<string, number>;
  byTopic: Record<string, number>;
}

export default function BulkImport({
  onClose,
  onImportComplete,
}: BulkImportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  const [results, setResults] = useState<ImportStats | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const csvFile = acceptedFiles.find(
      (file) => file.type === 'text/csv' || file.name.endsWith('.csv')
    );

    if (csvFile) {
      setFile(csvFile);
      setErrors([]);
      previewCSV(csvFile);
    } else {
      toast.error('Please upload a CSV file');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.csv'],
    },
    multiple: false,
  });

  const previewCSV = (file: File) => {
    Papa.parse(file, {
      header: true,
      preview: 5,
      complete: (results) => {
        setPreviewData(results.data);
        setShowPreview(true);
      },
      error: (error) => {
        toast.error(`CSV parsing error: ${error.message}`);
      },
    });
  };

  const validateRow = (row: any, index: number): string[] => {
    const errors: string[] = [];

    if (!row.Question && !row.question_text && !row['Question Text']) {
      errors.push(`Row ${index + 1}: Missing question text`);
    }

    if (!row.Topic && !row.topic) {
      errors.push(`Row ${index + 1}: Missing topic`);
    }

    return errors;
  };

  const normalizeRow = (row: any): Partial<ParsedQuestion> => {
    // Flexible column mapping
    const questionText =
      row.Question || row.question_text || row['Question Text'] || '';
    const topic = row.Topic || row.topic || '';
    const type = (
      row.Type ||
      row.type ||
      row.question_type ||
      'mcq'
    ).toLowerCase();

    // Normalize question type
    let question_type: ParsedQuestion['question_type'] = 'mcq';
    if (type.includes('true') || type.includes('false') || type === 'tf') {
      question_type = 'true_false';
    } else if (type.includes('essay')) {
      question_type = 'essay';
    } else if (type.includes('short') || type.includes('fill')) {
      question_type = 'short_answer';
    }

    // Extract choices for MCQ
    let choices: Record<string, string> | undefined;
    if (question_type === 'mcq') {
      choices = {};
      ['A', 'B', 'C', 'D', 'E', 'F'].forEach((letter) => {
        const choice =
          row[letter] ||
          row[`Choice ${letter}`] ||
          row[`choice_${letter.toLowerCase()}`];
        if (choice && choice.trim()) {
          choices![letter] = choice.trim();
        }
      });

      // If no choices found, default to placeholder choices
      if (Object.keys(choices).length === 0) {
        choices = {
          A: 'Option A',
          B: 'Option B',
          C: 'Option C',
          D: 'Option D',
        };
      }
    }

    return {
      topic: topic.trim(),
      question_text: questionText.trim(),
      question_type,
      choices,
      correct_answer:
        row.Correct || row.correct_answer || row['Correct Answer'] || 'A',
      bloom_level: row.Bloom || row.bloom_level || row['Bloom Level'],
      difficulty: row.Difficulty || row.difficulty,
      knowledge_dimension:
        row.KnowledgeDimension ||
        row.knowledge_dimension ||
        row['Knowledge Dimension'],
    };
  };

  const processImport = async () => {
    if (!file) return;

    setIsProcessing(true);
    setProgress(0);
    setCurrentStep('Parsing CSV file...');
    setErrors([]);

    try {
      // Parse CSV
      const parseResult = await new Promise<Papa.ParseResult<any>>(
        (resolve, reject) => {
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: resolve,
            error: reject,
          });
        }
      );

      const rawData = parseResult.data;
      setProgress(20);
      setCurrentStep('Validating data...');

      // Validate and normalize data
      const validationErrors: string[] = [];
      const normalizedData: ParsedQuestion[] = [];

      rawData.forEach((row, index) => {
        const rowErrors = validateRow(row, index);
        validationErrors.push(...rowErrors);

        if (rowErrors.length === 0) {
          const normalized = normalizeRow(row);
          normalizedData.push({
            ...normalized,
            created_by: 'bulk_import',
            approved: false,
            needs_review: true,
          } as ParsedQuestion);
        }
      });

      if (validationErrors.length > 0) {
        setErrors(validationErrors);
        setIsProcessing(false);
        return;
      }

      setProgress(40);
      setCurrentStep('Classifying questions with AI...');

      // Classify questions using AI
      try {
        const classificationInput = normalizedData.map(q => ({
          text: q.question_text,
          type: q.question_type,
          topic: q.topic
        }));

        const classifications = await classifyQuestions(classificationInput);

        // Apply AI classifications
        normalizedData.forEach((question, index) => {
          const classification = classifications[index];
          if (classification) {
            question.bloom_level =
              question.bloom_level || classification.bloom_level;
            question.difficulty =
              question.difficulty || classification.difficulty;
            question.knowledge_dimension =
              question.knowledge_dimension ||
              classification.knowledge_dimension;
            question.ai_confidence_score = classification.confidence;
            question.needs_review = classification.needs_review;

            // Auto-approve high confidence questions
            if (classification.confidence >= 0.85) {
              question.approved = true;
              question.needs_review = false;
            }
          }
        });

        setProgress(60);
        setCurrentStep('AI classification completed successfully');
      } catch (aiError) {
        console.warn('AI classification failed, using fallback:', aiError);
        toast.warning(
          'AI classification unavailable, using rule-based classification'
        );

        setProgress(50);
        setCurrentStep('Applying fallback classification...');

        // Fallback to local classification
        normalizedData.forEach((question) => {
          const classification = classifyQuestion(
            question.question_text,
            question.question_type,
            question.topic
          );
          
          question.bloom_level = question.bloom_level || classification.bloom_level;
          question.difficulty = question.difficulty || classification.difficulty;
          question.knowledge_dimension = question.knowledge_dimension || classification.knowledge_dimension;
          question.ai_confidence_score = classification.confidence;
          question.needs_review = classification.needs_review;
        });

        setProgress(60);
        setCurrentStep('Fallback classification completed');
      }

      setProgress(80);
      setCurrentStep('Saving to database...');

      // Insert into database
      const insertedQuestions = await Questions.bulkInsert(normalizedData);


      setProgress(100);
      setCurrentStep('Import completed!');

      // Calculate statistics
      const stats: ImportStats = {
        total: normalizedData.length,
        processed: normalizedData.length,
        approved: normalizedData.filter((q) => q.approved).length,
        needsReview: normalizedData.filter((q) => q.needs_review).length,
        byBloom: {},
        byDifficulty: {},
        byTopic: {},
      };

      normalizedData.forEach((q) => {
        stats.byBloom[q.bloom_level!] =
          (stats.byBloom[q.bloom_level!] || 0) + 1;
        stats.byDifficulty[q.difficulty!] =
          (stats.byDifficulty[q.difficulty!] || 0) + 1;
        stats.byTopic[q.topic] = (stats.byTopic[q.topic] || 0) + 1;
      });

      setResults(stats);
      toast.success(
        `Successfully imported ${normalizedData.length} questions!`
      );

      // Trigger refresh of parent component
      onImportComplete();
    } catch (error) {
      console.error('Import error:', error);
      toast.error(
        `Import failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
      setErrors([
        error instanceof Error ? error.message : 'Unknown error occurred',
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadTemplate = () => {
    const template = [
      {
        Topic: 'Requirements Engineering',
        Question:
          'Define what a functional requirement is in software development.',
        Type: 'mcq',
        A: 'A requirement that specifies what the system should do',
        B: 'A requirement that specifies how the system should perform',
        C: 'A requirement that specifies system constraints',
        D: 'A requirement that specifies user interface design',
        Correct: 'A',
        Bloom: 'remembering',
        Difficulty: 'easy',
        KnowledgeDimension: 'factual',
      },
      {
        Topic: 'Data Modeling',
        Question:
          'Explain the difference between conceptual and logical data models.',
        Type: 'essay',
        Correct:
          'Conceptual models show high-level entities and relationships, while logical models include detailed attributes and constraints.',
        Bloom: 'understanding',
        Difficulty: 'average',
        KnowledgeDimension: 'conceptual',
      },
    ];

    const csv = Papa.unparse(template);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'question_import_template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success('Template downloaded successfully!');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Bulk Import Questions</h2>
          <p className="text-muted-foreground">
            Import questions from CSV with AI-powered classification
          </p>
        </div>
        <Button variant="outline" onClick={onClose}>
          <X className="h-4 w-4 mr-2" />
          Close
        </Button>
      </div>

      {/* Template Download */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            CSV Template
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Download our CSV template to ensure your data is formatted correctly
            for import.
          </p>
          <Button onClick={downloadTemplate} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Download Template
          </Button>
        </CardContent>
      </Card>

      {/* File Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload CSV File
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragActive
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-primary/50'
            }`}
          >
            <input {...getInputProps()} />
            <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            {isDragActive ? (
              <p className="text-lg">Drop the CSV file here...</p>
            ) : (
              <div>
                <p className="text-lg mb-2">
                  Drag & drop a CSV file here, or click to select
                </p>
                <p className="text-sm text-muted-foreground">
                  Supports .csv files up to 10MB
                </p>
              </div>
            )}
          </div>

          {file && (
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                <span className="font-medium">{file.name}</span>
                <Badge variant="secondary">
                  {(file.size / 1024).toFixed(1)} KB
                </Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview */}
      {showPreview && previewData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Data Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    {Object.keys(previewData[0]).map((key) => (
                      <th key={key} className="text-left p-2 font-medium">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.map((row, index) => (
                    <tr key={index} className="border-b">
                      {Object.values(row).map((value: any, cellIndex) => (
                        <td key={cellIndex} className="p-2 max-w-xs truncate">
                          {String(value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Showing first 5 rows. Total rows will be processed during import.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              <p className="font-medium">Import errors found:</p>
              <ul className="list-disc list-inside space-y-1">
                {errors.slice(0, 10).map((error, index) => (
                  <li key={index} className="text-sm">
                    {error}
                  </li>
                ))}
              </ul>
              {errors.length > 10 && (
                <p className="text-sm">
                  ... and {errors.length - 10} more errors
                </p>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Processing */}
      {isProcessing && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 animate-pulse" />
              Processing Import
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span>{currentStep}</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="w-full" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {results && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Import Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary">
                  {results.total}
                </div>
                <div className="text-sm text-muted-foreground">
                  Total Imported
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-500">
                  {results.approved}
                </div>
                <div className="text-sm text-muted-foreground">
                  Auto-Approved
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-500">
                  {results.needsReview}
                </div>
                <div className="text-sm text-muted-foreground">Need Review</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-500">
                  {Object.keys(results.byTopic).length}
                </div>
                <div className="text-sm text-muted-foreground">Topics</div>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <h4 className="font-medium mb-2">By Bloom Level</h4>
                <div className="space-y-1">
                  {Object.entries(results.byBloom).map(([level, count]) => (
                    <div key={level} className="flex justify-between text-sm">
                      <span className="capitalize">{level}</span>
                      <Badge variant="secondary">{count}</Badge>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-2">By Difficulty</h4>
                <div className="space-y-1">
                  {Object.entries(results.byDifficulty).map(
                    ([difficulty, count]) => (
                      <div
                        key={difficulty}
                        className="flex justify-between text-sm"
                      >
                        <span className="capitalize">{difficulty}</span>
                        <Badge variant="secondary">{count}</Badge>
                      </div>
                    )
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-2">By Topic</h4>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {Object.entries(results.byTopic).map(([topic, count]) => (
                    <div key={topic} className="flex justify-between text-sm">
                      <span className="truncate">{topic}</span>
                      <Badge variant="secondary">{count}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        {file && !isProcessing && !results && (
          <Button onClick={processImport} className="flex-1">
            <Sparkles className="h-4 w-4 mr-2" />
            Process Import
          </Button>
        )}

        {results && (
          <Button onClick={onClose} className="flex-1">
            <CheckCircle className="h-4 w-4 mr-2" />
            Complete
          </Button>
        )}
      </div>
    </div>
  );
}
