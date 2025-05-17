
"use client";

import { useState, useEffect } from 'react';
import { Mic, MicOff, AlertTriangle, Info, Brain, PlayCircle, StopCircle, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { WAKE_WORDS, RECORDING_DURATION_MS } from '@/lib/constants';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface PassiveListenerControlsProps {
  isListening: boolean;
  onToggleListening: (isListening: boolean) => void;
}

export function PassiveListenerControls({ isListening, onToggleListening }: PassiveListenerControlsProps) {
  const [showWarning, setShowWarning] = useState(false);
  const [isAccordionOpen, setIsAccordionOpen] = useState(false);


  useEffect(() => {
    let timerId: NodeJS.Timeout | undefined;
    if (isListening) {
      setShowWarning(true);
      // If listening is active, default the accordion to open to show the warning.
      // Only do this if it's not already open to avoid forcing it open on every re-render.
      if (!isAccordionOpen) setIsAccordionOpen(true); 
      timerId = setTimeout(() => {
        setShowWarning(false);
      }, 5000);
    } else {
      setShowWarning(false);
      // Optionally close accordion when listening is turned off
      // setIsAccordionOpen(false); 
    }
    return () => {
      if (timerId) {
        clearTimeout(timerId);
      }
    };
  }, [isListening, isAccordionOpen]);

  const handleToggleSwitch = (checked: boolean) => {
    onToggleListening(checked);
  };

  const recallCmdSuffix = WAKE_WORDS.HEGGLES_REPLAY_THAT.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const addShopCmdSuffix = WAKE_WORDS.ADD_TO_SHOPPING_LIST_FULL_PREFIX_REGEX_PART;
  const addToDoCmdSuffix = WAKE_WORDS.ADD_TO_TODO_LIST_FULL_PREFIX_REGEX_PART;
  const setBufferCmdSuffix = WAKE_WORDS.HEGGLES_SET_BUFFER.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const turnOnCmdSuffix = WAKE_WORDS.HEGGLES_TURN_ON.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const turnOffCmdSuffix = WAKE_WORDS.HEGGLES_TURN_OFF.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const deleteItemSuffix = WAKE_WORDS.DELETE_ITEM_PREFIX.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const recordingDurationSeconds = RECORDING_DURATION_MS / 1000;


  return (
    <Card className="w-full shadow-lg">
      <Accordion 
        type="single" 
        collapsible 
        value={isAccordionOpen ? "voice-commands-panel" : ""}
        onValueChange={(value) => setIsAccordionOpen(value === "voice-commands-panel")}
      >
        <AccordionItem value="voice-commands-panel" className="border-b-0">
          <CardHeader className="p-4">
            <AccordionTrigger className="p-0 hover:no-underline">
              <div className="flex flex-row justify-between items-center w-full">
                <div className="flex items-center">
                  {isListening ? <Mic className="mr-2 h-6 w-6 text-primary animate-pulse" /> : <MicOff className="mr-2 h-6 w-6 text-muted-foreground" />}
                  <CardTitle className="text-xl">
                    Voice Commands.
                  </CardTitle>
                </div>
              </div>
            </AccordionTrigger>
            <div className="flex items-center justify-between space-x-2 pt-3">
                <Label htmlFor="listening-mode-switch" className="text-base font-medium">
                    {isListening ? "Listening Active" : "Listening Inactive"}
                </Label>
                <Switch
                    id="listening-mode-switch"
                    checked={isListening}
                    onCheckedChange={handleToggleSwitch}
                    aria-label="Toggle voice command listening mode"
                />
            </div>
          </CardHeader>
          <AccordionContent>
            <CardContent className="pt-0 pb-4 px-4 space-y-4">
              {showWarning && (
                <div className="flex items-center p-3 border border-yellow-400 bg-yellow-50 text-yellow-700 rounded-md text-sm">
                  <AlertTriangle className="h-5 w-5 mr-2" />
                  <span>
                    Voice command listening is active. Microphone may be used for voice commands.
                  </span>
                </div>
              )}
              <div className="flex items-start p-3 border rounded-lg bg-secondary/30 text-sm text-muted-foreground">
                  <Info className="h-5 w-5 mr-2 mt-0.5 shrink-0 text-primary" />
                  <div>
                      Most voice commands starting with '<strong>Heggles</strong>' will populate the input area on the dashboard. Click the <Brain className="inline-block h-3 w-3 mx-0.5"/> icon to process the populated text.
                      The "Conceptual Buffer Time" (used by voice command '<strong>Heggles</strong>{setBufferCmdSuffix} [duration]') can be configured on the <Button variant="link" asChild className="p-0 h-auto text-sm text-muted-foreground underline"><a href="/settings">Settings page</a></Button>.
                      <ul className="list-disc pl-5 mt-1 space-y-0.5">
                        <li>Toggle listening: <q><strong>Heggles</strong>{turnOnCmdSuffix}</q> / <q><strong>Heggles</strong>{turnOffCmdSuffix}</q>. (Immediate action)</li>
                        <li>If "<strong>Heggles</strong>{recallCmdSuffix}" populates the input, clicking <Brain className="inline-block h-3 w-3 mx-0.5"/> triggers a {recordingDurationSeconds}-second live audio recording & transcription for processing.</li>
                        <li>Add to shopping list: <q><strong>Heggles</strong> {addShopCmdSuffix} [item] to my shopping list</q>. (Populates input for <Brain className="inline-block h-3 w-3 mx-0.5"/> processing & confirmation)</li>
                        <li>Add to to-do list: <q><strong>Heggles</strong> {addToDoCmdSuffix} [task] to my to do list</q>. (Populates input for <Brain className="inline-block h-3 w-3 mx-0.5"/> processing & confirmation)</li>
                        <li>Set buffer: <q><strong>Heggles</strong>{setBufferCmdSuffix} [e.g., 5 minutes / always on]</q>. (Immediate action, updates setting on Settings page)</li>
                        <li>Delete item: <q><strong>Heggles</strong> {deleteItemSuffix} [item/item number X] from [shopping list/to do list]</q>. (Populates input for <Brain className="inline-block h-3 w-3 mx-0.5"/> processing)</li>
                        <li>The <Mic className="inline-block h-3 w-3 mx-0.5 text-primary"/> icon button (in Input & Recall card) is for direct dictation into the input area (stops on pause or "<strong>Heggles</strong> end/stop"); then use <Brain className="inline-block h-3 w-3 mx-0.5"/> to process.</li>
                        <li>The <PlayCircle className="inline-block h-3 w-3 mx-0.5 text-green-500"/>/<StopCircle className="inline-block h-3 w-3 mx-0.5 text-red-500"/> button (header) is for continuous recording; its transcript populates the input area when stopped, then use <Brain className="inline-block h-3 w-3 mx-0.5"/> to process.</li>
                      </ul>
                  </div>
              </div>
            </CardContent>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}

