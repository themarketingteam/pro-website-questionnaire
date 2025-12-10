import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { base44 } from '@/api/base44Client';
import { Sparkles, Loader2, CheckCircle } from 'lucide-react';

export default function AIContentModal({ 
  open, 
  onClose, 
  currentValue, 
  questionContext,
  onInject 
}) {
  const [userInstruction, setUserInstruction] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCheckingGrammar, setIsCheckingGrammar] = useState(false);

  useEffect(() => {
    if (open) {
      setDraftContent(currentValue || '');
      setUserInstruction('');
    }
  }, [open, currentValue]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      // Create a conversation with the MSP Content Strategist agent
      const conversation = await base44.agents.createConversation({
        agent_name: 'msp_content_strategist',
        metadata: { source: 'pro_questionnaire' }
      });

      // Construct the message with context
      const message = `Question Context: ${questionContext}\n\nUser Instruction: ${userInstruction}\n\nCurrent Draft:\n${draftContent || '(empty)'}`;

      // Add message and wait for response
      await base44.agents.addMessage(conversation, {
        role: 'user',
        content: message
      });

      // Subscribe to get the response
      await new Promise((resolve) => {
        const unsubscribe = base44.agents.subscribeToConversation(conversation.id, (data) => {
          const lastMessage = data.messages[data.messages.length - 1];
          if (lastMessage && lastMessage.role === 'assistant' && !lastMessage.streaming) {
            setDraftContent(lastMessage.content);
            setUserInstruction('');
            unsubscribe();
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('Failed to generate content:', error);
      alert('Failed to generate content. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGrammarCheck = async () => {
    setIsCheckingGrammar(true);
    try {
      const conversation = await base44.agents.createConversation({
        agent_name: 'msp_content_strategist',
        metadata: { source: 'pro_questionnaire_grammar' }
      });

      const message = `Fix spelling and grammar errors in the following text. Do not change the tone or length. Return only the corrected text without any additional commentary.\n\n${draftContent}`;

      await base44.agents.addMessage(conversation, {
        role: 'user',
        content: message
      });

      await new Promise((resolve) => {
        const unsubscribe = base44.agents.subscribeToConversation(conversation.id, (data) => {
          const lastMessage = data.messages[data.messages.length - 1];
          if (lastMessage && lastMessage.role === 'assistant' && !lastMessage.streaming) {
            setDraftContent(lastMessage.content);
            unsubscribe();
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('Failed to check grammar:', error);
      alert('Failed to check grammar. Please try again.');
    } finally {
      setIsCheckingGrammar(false);
    }
  };

  const handleInject = () => {
    onInject(draftContent);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            AI Content Assistant
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* User Instruction */}
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">
              Tell the AI what to do
            </label>
            <Input
              placeholder="e.g., 'Make this more professional' or 'Focus on our speed'"
              value={userInstruction}
              onChange={(e) => setUserInstruction(e.target.value)}
              className="w-full"
            />
          </div>

          {/* Draft Content */}
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">
              Draft Content
            </label>
            <Textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              rows={12}
              className="w-full font-mono text-sm"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !userInstruction.trim()}
              className="flex-1 bg-purple-600 hover:bg-purple-700"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate
                </>
              )}
            </Button>

            <Button
              onClick={handleGrammarCheck}
              disabled={isCheckingGrammar || !draftContent.trim()}
              variant="outline"
              className="flex-1"
            >
              {isCheckingGrammar ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Grammar Check
                </>
              )}
            </Button>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            onClick={handleInject}
            className="bg-green-600 hover:bg-green-700"
          >
            Inject Answer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}