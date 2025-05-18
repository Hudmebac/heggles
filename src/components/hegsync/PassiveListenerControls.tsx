
"use client";

import { useState, useEffect, useRef } from 'react';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, Brain, PlayCircle, StopCircle, Mic, Info, Settings, ChevronDown, ChevronUp } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle as UiAlertTitle } from '@/components/ui/alert';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

// This component is no longer used for wake words on the dashboard.
// Its switch might control the availability of the header continuous recording mic.
// Or it can be purely informational.
// For now, I will remove most of its content to reflect no dashboard wake words.

export function PassiveListenerControls() {
  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle className="text-xl flex items-center">
            <Info className="mr-2 h-5 w-5 text-primary" /> Information
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Voice input on the dashboard is initiated by clicking the microphone buttons.
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2 text-sm text-muted-foreground">
          <li>Use the <Mic className="inline-block h-3.5 w-3.5 align-middle"/> icon in the header for continuous recording. The transcript will appear in the "Input & Recall" area.</li>
          <li>Use the <Mic className="inline-block h-3.5 w-3.5 align-middle"/> icon in the "Input & Recall" card for dictating directly into the text area.</li>
          <li>Click the <Brain className="inline-block h-3.5 w-3.5 align-middle"/> icon to process the text from the "Input & Recall" area.</li>
          <li>Text commands like "heggles add [item] to shopping list", "empty recent thoughts", etc., can be typed or dictated into the input area and then processed using the Brain icon.</li>
        </ul>
      </CardContent>
    </Card>
  );
}
