
"use client";

import { useState } from 'react';
import { Brain, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { processRecalledAudio } from '@/lib/actions';
import type { Thought } from '@/lib/types';

interface ThoughtInputFormProps {
  onThoughtRecalled: (thought: Thought) => void;
  isListening: boolean;
}

export function ThoughtInputForm({ onThoughtRecalled, isListening }: ThoughtInputFormProps) {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) {
      toast({ title: "Input empty", description: "Please provide some text to recall.", variant: "destructive" });
      return;
    }
    if (!isListening) {
      toast({ title: "Listening Inactive", description: "Please enable passive listening to recall a thought.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const processedData = await processRecalledAudio(inputText);
      const newThought: Thought = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        ...processedData,
      };
      onThoughtRecalled(newThought);
      setInputText(''); // Clear input after successful recall
      toast({ title: "Thought Recalled", description: "AI processing complete." });
    } catch (error) {
      toast({ title: "Error Recalling Thought", description: (error as Error).message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full shadow-lg">
      <CardHeader>
        <CardTitle className="text-xl">Recall Thought</CardTitle>
        <CardDescription>
          {isListening 
            ? "The (simulated) audio buffer is ready. Paste or type content below to process it." 
            : "Enable passive listening above to recall the current audio buffer."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Textarea
            placeholder={isListening ? "Paste or type your recalled thought here... (simulated audio buffer)" : "Enable listening to activate input..."}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={4}
            disabled={!isListening || isLoading}
            className="resize-none"
          />
          <Button type="submit" disabled={!isListening || isLoading || !inputText.trim()} className="w-full sm:w-auto">
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Brain className="mr-2 h-4 w-4" />}
            Process with AI
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
