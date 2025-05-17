
"use client";

import { Pin, Sparkles, MessageSquareText, Tags, CalendarDays, AlertCircle, Trash2 } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Thought, PinnedThought } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';

interface ThoughtCardProps {
  thought: Thought | PinnedThought;
  onPin: (thought: Thought) => void;
  onClarify: (thought: Thought) => void;
  onDelete?: (thoughtId: string) => void; // Optional: only for recalled thoughts
  isPinned?: boolean;
}

export function ThoughtCard({ thought, onPin, onClarify, onDelete, isPinned = false }: ThoughtCardProps) {
  const timeAgo = formatDistanceToNow(new Date(thought.timestamp), { addSuffix: true });

  return (
    <Card className="shadow-md hover:shadow-lg transition-shadow duration-200 flex flex-col h-full">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-lg flex items-center">
              <MessageSquareText className="mr-2 h-5 w-5 text-primary" />
              Thought
            </CardTitle>
            <CardDescription className="flex items-center mt-1">
              <CalendarDays className="mr-1.5 h-4 w-4 text-muted-foreground" /> {timeAgo}
            </CardDescription>
          </div>
          <div className="flex items-center space-x-1">
            {onDelete && !isPinned && (
              <Button variant="ghost" size="icon" onClick={() => onDelete(thought.id)} title="Delete this thought">
                <Trash2 className="h-5 w-5 text-destructive" />
              </Button>
            )}
            {!isPinned && (
               <Button variant="ghost" size="icon" onClick={() => onPin(thought)} title="Pin this thought">
                <Pin className="h-5 w-5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 flex-grow">
        <div>
          <h4 className="font-semibold text-sm mb-1">Original Text:</h4>
          <p className="text-sm text-muted-foreground max-h-24 overflow-y-auto p-2 bg-secondary/30 rounded-md whitespace-pre-wrap">
            {thought.originalText}
          </p>
        </div>
        {thought.summary && (
          <div>
            <h4 className="font-semibold text-sm mb-1">AI Summary:</h4>
            <p className="text-sm text-muted-foreground p-2 bg-secondary/30 rounded-md">{thought.summary}</p>
          </div>
        )}
        {thought.keywords && thought.keywords.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-1 flex items-center">
              <Tags className="mr-1.5 h-4 w-4 text-muted-foreground" /> Keywords:
            </h4>
            <div className="flex flex-wrap gap-1">
              {thought.keywords.map((keyword, index) => (
                <Badge key={index} variant="secondary">
                  {keyword}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {(thought as PinnedThought).categories && ((thought as PinnedThought).categories?.length ?? 0) > 0 && (
           <div>
            <h4 className="font-semibold text-sm mb-1">Categories:</h4>
            <div className="flex flex-wrap gap-1">
              {(thought as PinnedThought).categories!.map((category, index) => (
                <Badge key={index} variant="outline" className="bg-primary/10 text-primary-foreground">
                  {category}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {thought.refinedTranscript && (
          <div>
            <h4 className="font-semibold text-sm mb-1 text-primary flex items-center">
              <Sparkles className="mr-1.5 h-4 w-4"/> Refined Transcript:
            </h4>
            <p className="text-sm text-muted-foreground p-2 bg-primary/10 rounded-md whitespace-pre-wrap">{thought.refinedTranscript}</p>
          </div>
        )}
        {thought.actionItems && thought.actionItems.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-1 text-primary flex items-center">
              <AlertCircle className="mr-1.5 h-4 w-4"/> Action Items:
            </h4>
            <ul className="list-disc list-inside space-y-1 pl-1">
              {thought.actionItems.map((item, index) => (
                <li key={index} className="text-sm p-1 bg-primary/10 rounded-md">{item}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button variant="outline" size="sm" onClick={() => onClarify(thought)} className="w-full">
          <Sparkles className="mr-2 h-4 w-4" />
          {thought.refinedTranscript ? "View/Re-Clarify" : "Clarify with AI"}
        </Button>
      </CardFooter>
    </Card>
  );
}
