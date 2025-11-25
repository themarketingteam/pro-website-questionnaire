import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function QuestionWrapper({ 
  number, 
  title, 
  guidance, 
  why,
  children, 
  isCollapsible = true,
  isExpanded = true,
  onToggle,
  required = false
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div 
          className={`block flex-1 ${isCollapsible ? 'cursor-pointer' : ''}`}
          onClick={isCollapsible ? onToggle : undefined}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-slate-900">
              {number}. {title}
              {required && <span className="text-red-500 ml-1">*</span>}
            </span>
            
            {(guidance || why) && (
              <TooltipProvider>
                <Tooltip open={showTooltip} onOpenChange={setShowTooltip}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="w-6 h-6 rounded-full border border-slate-300 hover:border-slate-400 flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-all"
                      aria-label="More information"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowTooltip(!showTooltip);
                      }}
                    >
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent 
                    side="right" 
                    className="max-w-sm p-4 bg-white border border-slate-200 shadow-xl"
                  >
                    {why && (
                      <div className="mb-3">
                        <p className="font-semibold text-slate-900 text-sm mb-1">Why we ask:</p>
                        <p className="text-slate-600 text-sm">{why}</p>
                      </div>
                    )}
                    {guidance && (
                      <div>
                        <p className="font-semibold text-slate-900 text-sm mb-1">Guidance:</p>
                        <p className="text-slate-600 text-sm">{guidance}</p>
                      </div>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            
            {isCollapsible && (
              isExpanded ? (
                <ChevronUp className="w-5 h-5 text-slate-400 ml-auto" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400 ml-auto" />
              )
            )}
          </div>
        </div>
      </div>
      
      {isExpanded && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-200">
          {children}
        </div>
      )}
    </div>
  );
}