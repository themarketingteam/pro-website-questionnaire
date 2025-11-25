import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Send, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';

import FormHeader from '@/components/pro-form/FormHeader';
import QuestionWrapper from '@/components/pro-form/QuestionWrapper';
import YesNoQuestion from '@/components/pro-form/YesNoQuestion';
import CheckboxQuestion from '@/components/pro-form/CheckboxQuestion';
import RadioQuestion from '@/components/pro-form/RadioQuestion';
import TextareaQuestion from '@/components/pro-form/TextareaQuestion';
import MultiTextQuestion from '@/components/pro-form/MultiTextQuestion';
import FileUploadQuestion from '@/components/pro-form/FileUploadQuestion';
import NumericRangeQuestion from '@/components/pro-form/NumericRangeQuestion';
import SelectionSpanIndicator from '@/components/pro-form/SelectionSpanIndicator';
import AutoSaveIndicator from '@/components/pro-form/AutoSaveIndicator';
import { QUESTIONS, SERVICE_OPTIONS_GROUPED } from '@/components/pro-form/questionData';

const COOKIE_NAME = 'pro_questionnaire_responses';

export default function ProQuestionnaire() {
  const [responses, setResponses] = useState({});
  const [expandedQuestions, setExpandedQuestions] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allExpanded, setAllExpanded] = useState(false);
  const [showAutoSave, setShowAutoSave] = useState(0);

  // Load from cookie on mount
  useEffect(() => {
    const saved = localStorage.getItem(COOKIE_NAME);
    let initialResponses = {};
    if (saved) {
      try {
        initialResponses = JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse saved responses:', e);
      }
    }
    // Default Q1 and Q2 to "no" if not set
    if (!initialResponses['1']) initialResponses['1'] = 'no';
    if (!initialResponses['2']) initialResponses['2'] = 'no';
    setResponses(initialResponses);
    
    // Initialize all questions as collapsed
    const expanded = {};
    QUESTIONS.forEach(q => {
      expanded[q.id] = false;
      if (q.conditionalChildren) {
        q.conditionalChildren.forEach(child => {
          expanded[child.id] = false;
        });
      }
    });
    setExpandedQuestions(expanded);
  }, []);

  // Auto-save to cookie
  const saveToStorage = useCallback((data) => {
    localStorage.setItem(COOKIE_NAME, JSON.stringify(data));
  }, []);

  const updateResponse = (questionId, value) => {
    const newResponses = { ...responses, [questionId]: value };
    setResponses(newResponses);
    saveToStorage(newResponses);
    setShowAutoSave(prev => prev + 1);
  };

  const toggleQuestion = (questionId) => {
    setExpandedQuestions(prev => {
      const newState = { ...prev, [questionId]: !prev[questionId] };
      // If collapsing a parent with conditional children, collapse the children too
      const question = QUESTIONS.find(q => q.id === questionId);
      if (question?.conditionalChildren && prev[questionId]) {
        question.conditionalChildren.forEach(child => {
          newState[child.id] = false;
        });
      }
      return newState;
    });
  };

  const expandAll = () => {
    const expanded = {};
    QUESTIONS.forEach(q => {
      expanded[q.id] = true;
      if (q.conditionalChildren) {
        q.conditionalChildren.forEach(child => {
          expanded[child.id] = true;
        });
      }
    });
    setExpandedQuestions(expanded);
    setAllExpanded(true);
  };

  const collapseAll = () => {
    const collapsed = {};
    QUESTIONS.forEach(q => {
      collapsed[q.id] = false;
      if (q.conditionalChildren) {
        q.conditionalChildren.forEach(child => {
          collapsed[child.id] = false;
        });
      }
    });
    setExpandedQuestions(collapsed);
    setAllExpanded(false);
  };

  const clearAll = () => {
    if (window.confirm('Are you sure you want to clear all responses? This cannot be undone.')) {
      setResponses({});
      localStorage.removeItem(COOKIE_NAME);
      toast.success('All responses cleared');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const user = await base44.auth.me();
      
      await base44.entities.ProFormSubmission.create({
        submission_status: 'submitted',
        submitter_email: user?.email || '',
        submitter_name: user?.full_name || '',
        responses: responses,
        submitted_at: new Date().toISOString()
      });

      toast.success('Questionnaire submitted successfully!');
      localStorage.removeItem(COOKIE_NAME);
      setResponses({});
    } catch (error) {
      console.error('Submission error:', error);
      toast.error('Failed to submit. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculate span totals
  const otherServices = responses['4_other'];
  const otherServicesCount = Array.isArray(otherServices) 
    ? otherServices.filter(v => v?.trim()).length 
    : (otherServices?.trim() ? 1 : 0);
  const servicesCount = (responses['4'] || []).length + otherServicesCount;
  const industriesCount = (responses['5'] || []).length + (responses['5_other'] ? 1 : 0);
  const regionsCount = (responses['6'] || [''])?.filter(r => r.trim()).length || 0;

  // Group questions by section
  const sections = QUESTIONS.reduce((acc, question) => {
    if (!acc[question.section]) {
      acc[question.section] = [];
    }
    acc[question.section].push(question);
    return acc;
  }, {});

  const renderQuestion = (question, index) => {
    const commonProps = {
      value: responses[question.id],
      onChange: (val) => updateResponse(question.id, val)
    };

    switch (question.type) {
      case 'yes_no':
        return <YesNoQuestion {...commonProps} />;
      
      case 'checkbox':
        return (
          <CheckboxQuestion
            options={question.options}
            groupedOptions={question.id === "4" ? SERVICE_OPTIONS_GROUPED : null}
            value={responses[question.id] || []}
            onChange={(val) => updateResponse(question.id, val)}
            min={question.limits?.min}
            max={question.limits?.max}
            showOther={question.showOther}
            otherValue={responses[`${question.id}_other`] || (question.showOther && question.limits?.max ? [''] : '')}
            onOtherChange={(val) => updateResponse(`${question.id}_other`, val)}
            columns={question.id === "4" ? 3 : 2}
          />
        );
      
      case 'radio':
        return (
          <RadioQuestion
            options={question.options}
            {...commonProps}
            showOther={question.showOther}
            otherValue={responses[`${question.id}_other`] || ''}
            onOtherChange={(val) => updateResponse(`${question.id}_other`, val)}
          />
        );
      
      case 'textarea':
        return <TextareaQuestion {...commonProps} />;
      
      case 'multi_text':
        return (
          <MultiTextQuestion
            value={responses[question.id] || ['']}
            onChange={(val) => updateResponse(question.id, val)}
            min={question.limits?.min}
            max={question.limits?.max}
            placeholder="Enter a location"
          />
        );
      
      case 'file_upload':
        return <FileUploadQuestion {...commonProps} />;
      
      case 'numeric_range':
        return (
          <NumericRangeQuestion
            minValue={question.minValue}
            maxValue={question.maxValue}
            onChange={(val) => updateResponse(question.id, val)}
          />
        );
      
      default:
        return null;
    }
  };

  const renderConditionalChildren = (parent) => {
    // Hide children if parent is collapsed OR if answer is not "yes"
    if (!parent.conditionalChildren || responses[parent.id] !== 'yes' || !expandedQuestions[parent.id]) {
      return null;
    }

    return (
      <div className="mt-6 ml-6 pl-6 border-l-2 border-blue-200 space-y-8">
        {parent.conditionalChildren.map((child, idx) => (
          <QuestionWrapper
            key={child.id}
            number={child.id}
            title={child.title}
            guidance={child.guidance}
            why={child.why}
            examples={child.examples}
            isCollapsible={true}
            isExpanded={expandedQuestions[child.id]}
            onToggle={() => toggleQuestion(child.id)}
            required={child.requiredIfParentYes}
          >
            {renderQuestion(child)}
          </QuestionWrapper>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <FormHeader />
      
      <main className="max-w-4xl mx-auto px-6 py-12">
        {/* Expand/Collapse Controls */}
        <div className="flex gap-3 mb-8">
          <button
            type="button"
            onClick={expandAll}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors text-sm"
          >
            Expand All
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors text-sm"
          >
            Collapse All
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-16">
          {Object.entries(sections).map(([sectionName, sectionQuestions], sectionIndex) => (
            <section key={sectionName} className="space-y-8">
              <div className="pb-6 border-b-2 border-slate-200">
                <h2 className="text-2xl font-bold text-slate-900">
                  Section {sectionIndex + 1}: {sectionName}
                </h2>
              </div>

              {sectionQuestions.map((question, qIndex) => (
                <div key={question.id}>
                  {/* Show span indicator before question 4 */}
                  {question.id === "4" && (
                    <div className="mb-8">
                      <SelectionSpanIndicator
                        servicesCount={servicesCount}
                        industriesCount={industriesCount}
                        regionsCount={regionsCount}
                      />
                    </div>
                  )}
                  
                  <QuestionWrapper
                    number={question.id}
                    title={question.title}
                    guidance={question.guidance}
                    why={question.why}
                    examples={question.examples}
                    isCollapsible={true}
                    isExpanded={expandedQuestions[question.id]}
                    onToggle={() => toggleQuestion(question.id)}
                  >
                    {renderQuestion(question)}
                    
                    {/* Show span indicator after Q6 */}
                    {question.id === "6" && (
                      <div className="mt-6">
                        <SelectionSpanIndicator
                          servicesCount={servicesCount}
                          industriesCount={industriesCount}
                          regionsCount={regionsCount}
                        />
                      </div>
                    )}
                  </QuestionWrapper>
                  
                  {renderConditionalChildren(question)}
                </div>
              ))}
            </section>
          ))}

          {/* Submit Section */}
          <div className="pt-8 border-t-2 border-slate-200">
            <div className="flex flex-col sm:flex-row gap-4">
              <Button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-6 text-lg font-semibold rounded-xl shadow-lg shadow-blue-500/25 transition-all hover:shadow-xl hover:shadow-blue-500/30"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5 mr-2" />
                    Submit Questionnaire
                  </>
                )}
              </Button>
              
              <Button
                type="button"
                variant="outline"
                onClick={clearAll}
                className="px-8 py-6 text-slate-600 border-slate-300 hover:bg-red-50 hover:text-red-600 hover:border-red-300 rounded-xl transition-all"
              >
                <RotateCcw className="w-5 h-5 mr-2" />
                Clear All
              </Button>
            </div>
          </div>
        </form>
      </main>

      <AutoSaveIndicator show={showAutoSave} />
    </div>
  );
}