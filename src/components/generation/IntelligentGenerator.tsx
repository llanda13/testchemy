import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

export default function IntelligentGenerator() {
  const [topic, setTopic] = useState('');
  const [bloomLevel, setBloomLevel] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [count, setCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleGenerate = async () => {
    if (!topic || !bloomLevel || !difficulty) {
      toast({
        title: "Missing Information",
        description: "Please fill in all fields",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-questions', {
        body: { topic, bloomLevel, difficulty, count }
      });

      if (error) throw error;

      toast({
        title: "Questions Generated",
        description: `Successfully generated ${count} question(s)`,
      });
    } catch (error) {
      console.error('Generation error:', error);
      toast({
        title: "Generation Failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Topic</Label>
        <Input
          placeholder="e.g., Photosynthesis, Algebra, World War II"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Bloom's Level</Label>
          <Select value={bloomLevel} onValueChange={setBloomLevel}>
            <SelectTrigger>
              <SelectValue placeholder="Select level" />
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

        <div className="space-y-2">
          <Label>Difficulty</Label>
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger>
              <SelectValue placeholder="Select difficulty" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="easy">Easy</SelectItem>
              <SelectItem value="average">Average</SelectItem>
              <SelectItem value="difficult">Difficult</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Number of Questions</Label>
        <Input
          type="number"
          min="1"
          max="10"
          value={count}
          onChange={(e) => setCount(parseInt(e.target.value) || 1)}
        />
      </div>

      <Button onClick={handleGenerate} disabled={loading} className="w-full">
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {loading ? 'Generating...' : 'Generate Questions'}
      </Button>
    </div>
  );
}
