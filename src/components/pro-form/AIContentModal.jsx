import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { base44 } from '@/api/base44Client';
import { Sparkles, Loader2, CheckCircle, Info } from 'lucide-react';
import { toast } from 'sonner';

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
  const [aiQuestions, setAiQuestions] = useState('');

  useEffect(() => {
    if (open) {
      setDraftContent(currentValue || '');
      setUserInstruction('');
    }
  }, [open, currentValue]);

  const isQuestionResponse = (text) => {
    const hasMultipleQuestions = (text.match(/\?/g) || []).length >= 2;
    const hasQuestionPrompts = /could you|can you|do you|what|how|tell me more|help me/i.test(text);
    const isShort = text.length < 500;
    return hasMultipleQuestions && hasQuestionPrompts && isShort;
  };

  const handleGenerate = async () => {
    if (!userInstruction.trim()) {
      toast.error('Please enter instructions');
      return;
    }

    console.log('🚀 [AI Modal] Starting generation...');
    console.log('📝 [AI Modal] User instruction:', userInstruction);
    console.log('📄 [AI Modal] Current draft content:', draftContent);
    console.log('❓ [AI Modal] Question context:', questionContext);

    setIsGenerating(true);
    setAiQuestions(''); // Clear previous questions
    
    try {
      console.log('🔄 [AI Modal] Calling backend function...');
      const response = await base44.functions.invoke('generateAIContent', {
        userInstruction,
        questionContext,
        draftContent
      });

      console.log('✅ [AI Modal] Backend response:', response);

      if (response.data.error) {
        throw new Error(response.data.error);
      }

      const { content, isQuestions } = response.data;

      if (isQuestions) {
        console.log('❓ [AI Modal] Detected AI questions');
        setAiQuestions(content);
      } else {
        console.log('📝 [AI Modal] Detected draft content');
        setDraftContent(content);
        setAiQuestions('');
      }

      setUserInstruction('');
      console.log('🎉 [AI Modal] Generation complete!');
      toast.success('Content generated!');
    } catch (error) {
      console.error('❌ [AI Modal] Generation error:', error);
      toast.error(error.message || 'Failed to generate content.');
    } finally {
      setIsGenerating(false);
      console.log('🏁 [AI Modal] Generation process ended');
    }
  };

  const handleGrammarCheck = async () => {
    if (!draftContent.trim()) {
      toast.error('No content to check');
      return;
    }

    setIsCheckingGrammar(true);
    try {
      const conversation = await base44.agents.createConversation({
        agent_name: 'msp_content_strategist',
        metadata: { source: 'pro_questionnaire_grammar' }
      });

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Response timeout'));
        }, 45000);

        const unsubscribe = base44.agents.subscribeToConversation(conversation.id, (data) => {
          const messages = data.messages || [];
          const lastMessage = messages[messages.length - 1];
          
          if (lastMessage?.role === 'assistant') {
            const content = lastMessage.content || '';
            setDraftContent(content);
            
            if (lastMessage.streaming === false) {
              clearTimeout(timeout);
              unsubscribe();
              resolve();
            }
          }
        });

        base44.agents.addMessage(conversation, {
          role: 'user',
          content: `Fix grammar and spelling only. Return the corrected text:\n\n${draftContent}`
        }).catch(reject);
      });

      toast.success('Grammar checked!');
    } catch (error) {
      console.error('Grammar check error:', error);
      toast.error(error.message || 'Failed to check grammar.');
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
          {/* Question Context */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-sm font-semibold text-blue-900 mb-1">
              Current Question:
            </div>
            <div className="text-sm text-black">
              {questionContext.replace(/^Question \d+(\.\d+)?:\s*/, '')}
            </div>
          </div>

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

          {/* AI's Questions */}
          {aiQuestions && (
            <div className="space-y-2 p-4 bg-purple-50 border border-purple-200 rounded-lg">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-purple-600" />
                <label className="text-sm font-semibold text-purple-900">AI's Questions</label>
              </div>
              <div className="text-sm text-purple-800 whitespace-pre-wrap leading-relaxed">
                {aiQuestions}
              </div>
              <p className="text-xs text-purple-600 italic mt-2">
                Answer these questions in the Draft Content field below, then click Generate again.
              </p>
            </div>
          )}

          {/* Draft Content */}
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">
              Draft Content
            </label>
            <Textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              rows={12}
              className="w-full text-sm"
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