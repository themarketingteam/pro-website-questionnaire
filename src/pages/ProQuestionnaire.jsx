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
import MultiGeographicQuestion from '@/components/pro-form/MultiGeographicQuestion';
import FileUploadQuestion from '@/components/pro-form/FileUploadQuestion';
import NumericRangeQuestion from '@/components/pro-form/NumericRangeQuestion';
import MultiCertificationQuestion from '@/components/pro-form/MultiCertificationQuestion';
import ImageTaggingQuestion from '@/components/pro-form/ImageTaggingQuestion';
import InfoMessageQuestion from '@/components/pro-form/InfoMessageQuestion';
import SelectionSpanIndicator from '@/components/pro-form/SelectionSpanIndicator';
import AutoSaveIndicator from '@/components/pro-form/AutoSaveIndicator';
import ConfirmModal from '@/components/pro-form/ConfirmModal';
import { QUESTIONS, SERVICE_OPTIONS_GROUPED } from '@/components/pro-form/questionData';

const COOKIE_NAME = 'pro_questionnaire_responses';

export default function ProQuestionnaire() {
  const [responses, setResponses] = useState({});
  const [expandedQuestions, setExpandedQuestions] = useState({});
  const [touchedQuestions, setTouchedQuestions] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allExpanded, setAllExpanded] = useState(false);
  const [showAutoSave, setShowAutoSave] = useState(0);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Extract URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const businessNameParam = urlParams.get('businessName') || '';
  const domainSL = urlParams.get('domainSL') || '';
  const domainTL = urlParams.get('domainTL') || '';
  const domainParam = domainSL && domainTL ? `${domainSL}.${domainTL}` : '';

  // Set document title and favicon
  useEffect(() => {
    document.title = "Kaseya - Pro Website Content Form";
    
    const link = document.querySelector("link[rel*='icon']") || document.createElement('link');
    link.type = 'image/png';
    link.rel = 'icon';
    link.href = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6925fec3678942d22522b010/96c140c55_kaseya-logo.png';
    document.head.appendChild(link);
  }, []);

  // Load from cookie on mount
  useEffect(() => {
    const cookies = document.cookie.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {});
    
    let initialResponses = {};
    if (cookies[COOKIE_NAME]) {
      try {
        initialResponses = JSON.parse(decodeURIComponent(cookies[COOKIE_NAME]));
      } catch (e) {
        console.error('Failed to parse saved responses:', e);
      }
    }
    // Default Q1, Q2, and Q12 to "no" if not set
    if (!initialResponses['1']) initialResponses['1'] = 'no';
    if (!initialResponses['2']) initialResponses['2'] = 'no';
    if (!initialResponses['12']) initialResponses['12'] = 'no';
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
    const jsonData = JSON.stringify(data);
    const encodedData = encodeURIComponent(jsonData);
    // Set cookie to expire in 30 days
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    document.cookie = `${COOKIE_NAME}=${encodedData}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
  }, []);

  const updateResponse = (questionId, value) => {
    const newResponses = { ...responses, [questionId]: value };
    setResponses(newResponses);
    saveToStorage(newResponses);
    setShowAutoSave(prev => prev + 1);
  };

  const resetQuestion = (questionId) => {
    const newResponses = { ...responses };
    delete newResponses[questionId];
    delete newResponses[`${questionId}_other`];
    delete newResponses[`${questionId}_primary`];
    setResponses(newResponses);
    saveToStorage(newResponses);
    setShowAutoSave(prev => prev + 1);
  };

  const toggleQuestion = (questionId) => {
    setExpandedQuestions(prev => {
      const newState = { ...prev, [questionId]: !prev[questionId] };
      // If expanding, mark as touched
      if (!prev[questionId]) {
        setTouchedQuestions(t => ({ ...t, [questionId]: true }));
      }
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
      document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
      toast.success('All responses cleared');
    }
  };

  const isQuestionComplete = (questionId) => {
    const question = QUESTIONS.find(q => q.id === questionId);
    if (!question) return false;

    // Don't show complete until question is touched
    if (!touchedQuestions[questionId]) return false;

    const answer = responses[questionId];
    const otherValue = responses[`${questionId}_other`];

    switch (question.type) {
      case 'yes_no':
        const hasValidAnswer = answer === 'yes' || answer === 'no';
        // If answer is "yes" and has conditional children, check those too
        if (hasValidAnswer && answer === 'yes' && question.conditionalChildren) {
          const requiredChildren = question.conditionalChildren.filter(c => c.requiredIfParentYes);
          const allChildrenComplete = requiredChildren.every(child => isQuestionComplete(child.id));
          return allChildrenComplete;
        }
        return hasValidAnswer;
      
      case 'checkbox': {
        const selections = Array.isArray(answer) ? answer : [];
        let otherCount = 0;
        if (otherValue) {
          if (Array.isArray(otherValue)) {
            otherCount = otherValue.filter(v => v?.trim()).length;
          } else if (otherValue.trim()) {
            otherCount = 1;
          }
        }
        const totalCount = selections.length + otherCount;
        const min = question.limits?.min || 0;
        const max = question.limits?.max || Infinity;
        return totalCount >= min && totalCount <= max;
      }
      
      case 'radio':
        return !!answer && (answer !== 'Other' || (otherValue && otherValue.trim()));
      
      case 'textarea':
        return answer && answer.trim().length > 0;
      
      case 'multi_text': {
        const entries = Array.isArray(answer) ? answer : [];
        // For question 5 (geographic), check for validated locations
        if (questionId === '5') {
          const min = question.limits?.min || 1;
          return entries.length >= min;
        }
        // For other multi-text questions, check for filled text entries
        const filled = entries.filter(e => e?.trim()).length;
        const min = question.limits?.min || 0;
        return filled >= min;
      }
      
      case 'file_upload':
        return !!answer;
      
      case 'numeric_range':
        return answer && answer.trim().length > 0;

      case 'multi_certification': {
        const items = Array.isArray(answer) ? answer : [];
        // Count items that are either explicitly saved OR complete (legacy items)
        const validItems = items.filter(item => {
          const isComplete = item.name?.trim() && item.type;
          return item.saved === true || (isComplete && item.saved !== false);
        });
        const min = question.limits?.min || 0;
        return validItems.length >= min;
      }

          case 'image_tagging':
            return answer && answer.url && Array.isArray(answer.tags) && answer.tags.length > 0 && answer.tags.every(tag => tag.person?.name);

              case 'info_message':
                return true; // Info messages don't require user input

              default:
                return false;
    }
  };

  const getIncompleteQuestions = () => {
    const incomplete = [];
    for (let i = 1; i <= 25; i++) {
      const questionId = i.toString();
      const question = QUESTIONS.find(q => q.id === questionId);

      if (!question) continue;

      if (!isQuestionComplete(questionId)) {
        incomplete.push(`Q${questionId}: ${question.title}`);
      }

      // Check conditional children if parent is 'yes'
      if (question.conditionalChildren && responses[questionId] === 'yes') {
        for (const child of question.conditionalChildren) {
          if (child.requiredIfParentYes && !isQuestionComplete(child.id)) {
            incomplete.push(`Q${child.id}: ${child.title}`);
          }
        }
      }
    }
    return incomplete;
  };

  const isFormValid = () => {
    return getIncompleteQuestions().length === 0;
  };

  const handleSubmitClick = () => {
    if (!isFormValid()) {
      const incomplete = getIncompleteQuestions();
      const message = `Please complete all required fields:\n\n${incomplete.join('\n')}`;
      alert(message);
      return;
    }
    setShowConfirmModal(true);
  };

  const transformResponsesToPayload = (responses, businessName, domain) => {
    // Transform geographic areas - flatten structure, no wrapper
    const geographicAreas = (responses['5'] || []).map((location, index) => ({
      name: typeof location === 'string' ? location : (location.name || location.label || ''),
      label: typeof location === 'string' ? location : (location.label || location.name || ''),
      lat: location.lat != null ? String(location.lat) : '',
      lon: location.lon != null ? String(location.lon) : '',
      place_id: location.place_id || '',
      source: "google",
      primary: index === (responses['5_primary'] || 0)
    }));

    // Transform certifications/partnerships - always return array
    const certificationsPartnerships = responses['12'] === 'yes' && responses['12.1'] 
      ? (responses['12.1'] || []).map(item => ({
          cert_item_name: item.name || '',
          cert_item_type: item.type || '',
          cert_item_image_url: item.image?.url || '',
          cert_item_file_url: Array.isArray(item.files) && item.files.length > 0 ? item.files[0].url : ''
        }))
      : [];

    // Transform team photo - always return object structure
    const teamPhoto = responses['2'] === 'yes' && responses['2.2']
      ? responses['2.2']
      : { url: '', name: '', type: '', tags: [] };

    // Transform client frustrations to array
    const clientFrustrations = responses['19'] 
      ? (typeof responses['19'] === 'string' 
          ? responses['19'].split(',').map(s => s.trim()).filter(s => s) 
          : responses['19'])
      : [];

    return {
      metadata: {
        business_name: businessName,
        businessDomain: domain,
        submission_datetime: new Date().toISOString(),
        service_type: "pro"
      },
      userdata: {
        additional_pages_needed: responses['1'] === 'yes',
        additional_pages_list: responses['1'] === 'yes' ? (responses['1.1'] || '') : '',
        meet_the_team_page: responses['2'] === 'yes',
        team_introduction: responses['2'] === 'yes' ? (responses['2.1'] || '') : '',
        team_photo_with_tags: teamPhoto,
        service_offerings: (responses['3'] || []).filter(s => !s.startsWith('CATEGORY:')),
        service_offerings_categories: (responses['3'] || []).filter(s => s.startsWith('CATEGORY:')).map(s => s.replace('CATEGORY:', '')),
        service_offerings_other: responses['3_other'] || '',
        target_industries: responses['4'] || [],
        target_industries_other: responses['4_other'] || '',
        geographic_areas: geographicAreas,
        company_description: responses['6'] || '',
        delivery_model: responses['7'] || '',
        delivery_model_other: responses['7_other'] || '',
        pricing_packaging: responses['8'] || [],
        pricing_packaging_other: responses['8_other'] || '',
        differentiation: responses['9'] || '',
        company_goals: responses['10'] || [],
        company_goals_other: responses['10_other'] || '',
        brand_tone: responses['11'] || '',
        brand_tone_other: responses['11_other'] || '',
        certifications_partnerships: certificationsPartnerships,
        sales_process: responses['13'] || '',
        service_guarantee: responses['14'] === 'yes',
        service_guarantee_description: responses['14'] === 'yes' ? (responses['14a'] || '') : '',
        client_acquisition: responses['15'] || '',
        client_acquisition_other: responses['15_other'] || '',
        website_objectives: responses['16'] || [],
        website_objectives_other: responses['16_other'] || '',
        client_size: responses['17'] || '',
        client_challenges: responses['18'] || [],
        client_challenges_other: responses['18_other'] || '',
        client_frustrations: clientFrustrations,
        client_frustrations_other: responses['19_other'] || '',
        client_outcomes: responses['20'] || [],
        client_outcomes_other: responses['20_other'] || '',
        value_description: responses['21'] || '',
        ideal_client: responses['22'] || '',
        avoided_clients: responses['23'] || '',
        primary_cta: responses['24'] || '',
        primary_cta_other: responses['24_other'] || '',
        additional_notes: responses['25'] || ''
      }
    };
  };

  const handleConfirmSubmit = async (businessName, domain) => {
    setIsSubmitting(true);
    setShowConfirmModal(false);

    try {
      const user = await base44.auth.me();
      
      const submissionData = {
        submission_status: 'submitted',
        submitter_email: user?.email || '',
        submitter_name: user?.full_name || '',
        business_name: businessName,
        domain: domain,
        responses: responses,
        submitted_at: new Date().toISOString()
      };

      await base44.entities.ProFormSubmission.create(submissionData);

      // Transform payload for Zapier webhook
      const transformedPayload = transformResponsesToPayload(responses, businessName, domain);

      // Send to Zapier webhook
      const hookID = import.meta.env.VITE_API_HOOK_ID || "23529934";
      const hookKey = import.meta.env.VITE_API_HOOK_KEY || "uk2zhso";
      const webhookUrl = `https://hooks.zapier.com/hooks/catch/${hookID}/${hookKey}/`;
      
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transformedPayload)
      });

      toast.success('Questionnaire submitted successfully!');
      document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
      setResponses({});
    } catch (error) {
      console.error('Submission error:', error);
      toast.error('Failed to submit. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculate span totals
  const otherServices = responses['3_other'];
  const otherServicesCount = Array.isArray(otherServices) 
    ? otherServices.filter(v => v?.trim()).length 
    : (otherServices?.trim() ? 1 : 0);
  const servicesCount = (responses['3'] || []).length + otherServicesCount;
  const industriesCount = (responses['4'] || []).length + (responses['4_other'] ? 1 : 0);
  const regionsCount = Array.isArray(responses['5']) ? responses['5'].length : 0;

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
            groupedOptions={question.id === "3" ? SERVICE_OPTIONS_GROUPED : null}
            value={responses[question.id] || []}
            onChange={(val) => updateResponse(question.id, val)}
            min={question.limits?.min}
            max={question.limits?.max}
            showOther={question.showOther}
            otherValue={responses[`${question.id}_other`] || (question.showOther && question.limits?.max ? [''] : '')}
            onOtherChange={(val) => updateResponse(`${question.id}_other`, val)}
            columns={question.id === "3" ? 3 : 2}
            allowCategorySelection={question.id === "3"}
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
        // Question 5 uses geographic validation
        if (question.id === '5') {
          return (
            <MultiGeographicQuestion
              selectedLocations={responses[question.id] || []}
              primaryIndex={responses['5_primary'] || 0}
              onAdd={(location) => {
                setResponses(prev => {
                  const current = prev[question.id] || [];
                  const newResponses = { ...prev, [question.id]: [...current, location] };
                  saveToStorage(newResponses);
                  setShowAutoSave(s => s + 1);
                  return newResponses;
                });
              }}
              onRemove={(index) => {
                setResponses(prev => {
                  const current = prev[question.id] || [];
                  let primaryIndex = prev['5_primary'] || 0;
                  // Adjust primary index if we're removing it or something before it
                  if (index === primaryIndex) {
                    primaryIndex = 0; // Reset to first
                  } else if (index < primaryIndex) {
                    primaryIndex = primaryIndex - 1;
                  }
                  const newResponses = { 
                    ...prev, 
                    [question.id]: current.filter((_, i) => i !== index),
                    '5_primary': primaryIndex
                  };
                  saveToStorage(newResponses);
                  setShowAutoSave(s => s + 1);
                  return newResponses;
                });
              }}
              onSetPrimary={(index) => {
                setResponses(prev => {
                  const newResponses = { ...prev, '5_primary': index };
                  saveToStorage(newResponses);
                  setShowAutoSave(s => s + 1);
                  return newResponses;
                });
              }}
              maxLocations={question.limits?.max || 5}
            />
          );
        }
        // Other multi-text questions use simple text inputs
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
            value={responses[question.id]}
            onChange={(val) => updateResponse(question.id, val)}
          />
        );

      case 'multi_certification':
        return (
          <MultiCertificationQuestion
            value={responses[question.id] || []}
            onChange={(val) => updateResponse(question.id, val)}
            max={question.limits?.max || 10}
          />
        );

          case 'image_tagging':
            return <ImageTaggingQuestion {...commonProps} />;

                  case 'info_message':
                    return <InfoMessageQuestion 
                      guidance={question.guidance}
                      onLinkClick={() => {
                        // Scroll to question 12
                        const q12Element = document.getElementById('question-12');
                        if (q12Element) {
                          q12Element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          // Expand question 12 after a brief delay
                          setTimeout(() => {
                            setExpandedQuestions(prev => ({ ...prev, '12': true }));
                          }, 500);
                        }
                      }}
                    />;

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
            onReset={() => resetQuestion(child.id)}
            hasAnswer={!!responses[child.id] || !!responses[`${child.id}_other`]}
            isComplete={isQuestionComplete(child.id)}
            wasTouched={touchedQuestions[child.id]}
            isSubQuestion={true}
          >
            {renderQuestion(child)}
          </QuestionWrapper>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <FormHeader />
      
      <main className="max-w-4xl mx-auto px-6 py-12 pl-16">
        {/* Expand/Collapse Controls */}
        <div className="flex gap-3 mb-8">
          <button
            type="button"
            onClick={expandAll}
            className="px-4 py-2 bg-[#E8EBED] hover:bg-[#C1C6C8] text-[#1E3950] font-medium rounded transition-colors text-sm uppercase"
          >
            Expand All
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="px-4 py-2 bg-[#E8EBED] hover:bg-[#C1C6C8] text-[#1E3950] font-medium rounded transition-colors text-sm uppercase"
          >
            Collapse All
          </button>
        </div>

        <div className="space-y-16">
          {Object.entries(sections).map(([sectionName, sectionQuestions], sectionIndex) => (
            <section key={sectionName} className="space-y-8">
              <div className="pb-6 border-b-2 border-[#C1C6C8]">
                <h2 className="text-2xl font-bold text-[#122947]">
                  Section {sectionIndex + 1}: {sectionName}
                </h2>
              </div>

              {sectionQuestions.map((question, qIndex) => (
                <div key={question.id}>
                  {/* Show span indicator before question 3 */}
                  {question.id === "3" && (
                    <div className="mb-8">
                      <SelectionSpanIndicator
                        servicesCount={servicesCount}
                        industriesCount={industriesCount}
                        regionsCount={regionsCount}
                      />
                    </div>
                  )}

                  <QuestionWrapper
                    id={`question-${question.id}`}
                    number={question.id}
                    title={question.title}
                    guidance={question.guidance}
                    why={question.why}
                    examples={question.examples}
                    isCollapsible={true}
                    isExpanded={expandedQuestions[question.id]}
                    onToggle={() => toggleQuestion(question.id)}
                    onReset={() => resetQuestion(question.id)}
                    hasAnswer={!!responses[question.id] || !!responses[`${question.id}_other`]}
                    isComplete={isQuestionComplete(question.id)}
                    wasTouched={touchedQuestions[question.id]}
                  >
                    {renderQuestion(question)}

                    {/* Show span indicator after Q5 */}
                    {question.id === "5" && (
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
          <div className="pt-8 border-t-2 border-[#C1C6C8]">
            <div className="flex flex-col sm:flex-row gap-4">
              <button
                type="button"
                onClick={handleSubmitClick}
                disabled={!isFormValid() || isSubmitting}
                className={`flex-1 py-6 text-sm font-semibold rounded shadow-lg transition-all flex items-center justify-center uppercase tracking-wide ${
                  isFormValid() && !isSubmitting
                    ? 'bg-[#90C944] hover:bg-[#7DB83A] text-white shadow-lg hover:shadow-xl'
                    : 'bg-[#C1C6C8] text-[#566C75] cursor-not-allowed shadow-none'
                }`}
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
              </button>

              <Button
                type="button"
                variant="outline"
                onClick={clearAll}
                className="px-8 py-6 text-[#1E3950] border-[#C1C6C8] hover:bg-[#E8EBED] hover:border-[#A9AAAC] rounded transition-all uppercase text-sm tracking-wide"
              >
                <RotateCcw className="w-5 h-5 mr-2" />
                Clear All
              </Button>
            </div>
          </div>
          </div>
      </main>

      <AutoSaveIndicator show={showAutoSave} />

      {showConfirmModal && (
        <ConfirmModal
          formData={responses}
          onConfirm={handleConfirmSubmit}
          onCancel={() => setShowConfirmModal(false)}
          initialBusinessName={businessNameParam}
          initialDomain={domainParam}
        />
      )}
      </div>
      );
      }