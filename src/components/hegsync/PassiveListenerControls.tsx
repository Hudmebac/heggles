
"use client";

import { useState, useEffect } from 'react';
import { Mic, MicOff, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface PassiveListenerControlsProps {
  isListening: boolean;
  onToggleListening: (isListening: boolean) => void;
}

export function PassiveListenerControls({ isListening, onToggleListening }: PassiveListenerControlsProps) {
  const [showWarning, setShowWarning] = useState(false);

  // Handles the warning display logic, including initial state and subsequent toggles.
  useEffect(() => {
    let timerId: NodeJS.Timeout | undefined;
    if (isListening) {
      setShowWarning(true);
      timerId = setTimeout(() => {
        setShowWarning(false);
      }, 5000); // Hide warning after 5 seconds
    } else {
      // If isListening is false (either initially or after a toggle), ensure warning is hidden.
      setShowWarning(false);
    }

    // Cleanup function to clear the timer if the component unmounts or isListening changes
    return () => {
      if (timerId) {
        clearTimeout(timerId);
      }
    };
  }, [isListening]); // Re-run this effect whenever the `isListening` prop changes.

  // This function is called by the Switch component when its state changes by user interaction.
  const handleToggleSwitch = (checked: boolean) => {
    onToggleListening(checked); // Inform the parent component about the state change.
    // The useEffect above will handle updating `showWarning` based on the new `isListening` prop value.
  };
  
  return (
    <Card className="w-full shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center text-xl">
          {isListening ? <Mic className="mr-2 h-6 w-6 text-primary animate-pulse" /> : <MicOff className="mr-2 h-6 w-6 text-muted-foreground" />}
          Passive Listening
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between space-x-2 p-4 border rounded-lg bg-secondary/30">
          <Label htmlFor="listening-mode-switch" className="text-lg font-medium">
            {isListening ? "Listening Active" : "Listening Inactive"}
          </Label>
          <Switch
            id="listening-mode-switch"
            checked={isListening}
            onCheckedChange={handleToggleSwitch}
            aria-label="Toggle passive listening mode"
          />
        </div>
        {/* Warning is shown based on showWarning state, which is managed by the useEffect */}
        {showWarning && (
          <div className="flex items-center p-3 border border-yellow-400 bg-yellow-50 text-yellow-700 rounded-md text-sm">
            <AlertTriangle className="h-5 w-5 mr-2" />
            <span>
              Passive listening is active. Audio is being temporarily buffered locally.
              This is a simulation; no actual audio is recorded or stored persistently by this demo.
            </span>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          Toggle to {isListening ? "disable" : "enable"} passive listening mode. When active, the app (conceptually) maintains a temporary local audio buffer.
          Use the "Recall Thought" section to process the (simulated) buffered audio.
        </p>
      </CardContent>
    </Card>
  );
}
