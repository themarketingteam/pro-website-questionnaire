import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Lightbulb, HelpCircle } from 'lucide-react';

export default function QuestionHelpModal({ open, onClose, title, why, guidance, examples }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-slate-900 pr-6">
            {title}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-5 mt-2">
          {why && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <HelpCircle className="w-4 h-4 text-blue-600" />
                <h4 className="font-semibold text-slate-900 text-sm">Why we ask</h4>
              </div>
              <p className="text-slate-600 text-sm leading-relaxed">{why}</p>
            </div>
          )}
          
          {guidance && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h4 className="font-semibold text-slate-900 text-sm">Guidance</h4>
              </div>
              <p className="text-slate-600 text-sm leading-relaxed">{guidance}</p>
            </div>
          )}
          
          {examples && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-4 h-4 text-amber-600" />
                <h4 className="font-semibold text-amber-900 text-sm">Example Answers</h4>
              </div>
              <div className="space-y-2 text-sm">
                {typeof examples === 'string' ? (
                  <p className="text-amber-800 italic">"{examples}"</p>
                ) : examples.shortAnswer ? (
                  <p className="text-amber-800 italic">"{examples.shortAnswer}"</p>
                ) : examples.selections ? (
                  <div>
                    <ul className="list-disc list-inside text-amber-800 space-y-1">
                      {examples.selections.map((sel, idx) => (
                        <li key={idx}>{sel}</li>
                      ))}
                    </ul>
                    {examples.other && (
                      <p className="mt-2 text-amber-700">
                        <span className="font-medium">Other:</span> "{examples.other}"
                      </p>
                    )}
                  </div>
                ) : examples.entries ? (
                  <ul className="list-disc list-inside text-amber-800 space-y-1">
                    {examples.entries.map((entry, idx) => (
                      <li key={idx}>{entry}</li>
                    ))}
                  </ul>
                ) : examples.selection ? (
                  <p className="text-amber-800 italic">"{examples.selection}"</p>
                ) : examples.yes ? (
                  <div className="space-y-1">
                    <p className="text-amber-800"><span className="font-medium">Yes:</span> {examples.yes}</p>
                    <p className="text-amber-800"><span className="font-medium">No:</span> {examples.no}</p>
                  </div>
                ) : examples.fileTypes ? (
                  <div>
                    <p className="text-amber-800">Accepted formats: {examples.fileTypes.join(', ')}</p>
                    {examples.notes && <p className="text-amber-700 mt-1">{examples.notes}</p>}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}