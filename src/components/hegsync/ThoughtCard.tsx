
"use client";

import { Pin, Sparkles, MessageSquareText, Tags, CalendarDays, AlertCircle, Trash2, HelpCircle, CheckCircle, Volume2, Search } from 'lucide-react';
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

  const handlePlayAnswer = (textToSpeak: string | undefined) => {
    if (!textToSpeak) return;

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel(); // Cancel any ongoing speech
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      window.speechSynthesis.speak(utterance);
    } else {
      console.warn("Speech synthesis not supported in this browser.");
    }
  };

  const aiAnswerContainsUncertainty = (answer: string | undefined): boolean => {
    if (!answer) return false;
    const lowerAnswer = answer.toLowerCase();
    const uncertaintyPhrases = [
      "i cannot answer", "i couldn't find", "not sure", "unable to determine",
      "i'm unable to answer", "i do not have enough information", "search did not yield",
      "results were not conclusive", "i'm sorry, i can't answer", "i don't know"
    ];
    return uncertaintyPhrases.some(phrase => lowerAnswer.includes(phrase));
  };

  const questionForGoogleSearch = thought.intentAnalysis?.extractedQuestion || thought.originalText;
  const showGoogleSearchLink = thought.aiAnswer && aiAnswerContainsUncertainty(thought.aiAnswer);

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
        {thought.refinedTranscript && (
          <div>
            <h4 className="font-semibold text-sm mb-1 text-primary flex items-center">
              <Sparkles className="mr-1.5 h-4 w-4"/> Refined Transcript:
            </h4>
            <p className="text-sm text-muted-foreground p-2 bg-primary/10 rounded-md whitespace-pre-wrap">{thought.refinedTranscript}</p>
          </div>
        )}
         {thought.intentAnalysis?.isQuestion && thought.intentAnalysis.extractedQuestion && thought.aiAnswer && (
          <div className="space-y-1">
            <h4 className="font-semibold text-sm text-green-600 flex items-center justify-between">
              <span className="flex items-center">
                <HelpCircle className="mr-1.5 h-4 w-4"/> AI Answered Question:
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handlePlayAnswer(thought.aiAnswer)}
                title="Play AI Answer"
                className="h-6 w-6"
              >
                <Volume2 className="h-4 w-4" />
              </Button>
            </h4>
            <p className="text-sm text-muted-foreground italic p-1">Q: {thought.intentAnalysis.extractedQuestion}</p>
            <p className="text-sm text-green-700 bg-green-50 p-2 rounded-md">{thought.aiAnswer}</p>
            {showGoogleSearchLink && (
              <Button
                variant="outline"
                size="sm"
                asChild
                className="mt-2 w-full text-xs"
              >
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent(questionForGoogleSearch)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Search className="mr-2 h-3 w-3" />
                  Search on Google for "{questionForGoogleSearch.length > 30 ? questionForGoogleSearch.substring(0,27) + '...' : questionForGoogleSearch}"
                </a>
              </Button>
            )}
          </div>
        )}
        {thought.actionItems && thought.actionItems.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-1 text-orange-600 flex items-center">
              <AlertCircle className="mr-1.5 h-4 w-4"/> Action Items (from Refinement):
            </h4>
            <ul className="list-disc list-inside space-y-1 pl-1">
              {thought.actionItems.map((item, index) => (
                <li key={index} className="text-sm p-1 bg-orange-50 rounded-md">{item}</li>
              ))}
            </ul>
          </div>
        )}
         {thought.intentAnalysis?.isAction && thought.intentAnalysis.extractedAction && (
          <div>
            <h4 className="font-semibold text-sm mb-1 text-blue-600 flex items-center">
              <CheckCircle className="mr-1.5 h-4 w-4"/> Identified Action (from Intent):
            </h4>
            <p className="text-sm p-1 bg-blue-50 rounded-md">
              {thought.intentAnalysis.extractedAction}
              {thought.intentAnalysis.suggestedList && thought.intentAnalysis.suggestedList !== 'none' && (
                <span className="text-xs italic ml-1">(Suggested for: {thought.intentAnalysis.suggestedList})</span>
              )}
            </p>
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
