import React from 'react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { QUESTIONS } from './questionData';

export const generatePDF = async (formData, businessName, domain) => {
  // Create a condensed business name for filename
  const condensedName = businessName
    .replace(/[.,\s]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '');
  
  // Format date as M-D-YY
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  const year = today.getFullYear().toString().slice(-2);
  const dateString = `${month}-${day}-${year}`;
  
  const filename = `${condensedName}_KaseyaWebsite_ContentQuestionnaire_Responses_${dateString}.pdf`;

  // Create hidden container for PDF content
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '210mm'; // A4 width
  container.style.backgroundColor = 'white';
  container.style.padding = '20mm';
  container.style.fontFamily = 'system-ui, -apple-system, sans-serif';
  document.body.appendChild(container);

  // Helper function to format answers
  const formatAnswer = (questionId, answer, otherValue) => {
    if (!answer && !otherValue) return 'Not answered';
    
    let mainAnswer = '';
    if (Array.isArray(answer)) {
      mainAnswer = answer.length > 0 ? answer.join(', ') : '';
    } else if (typeof answer === 'string') {
      mainAnswer = answer;
    } else if (typeof answer === 'object' && answer !== null) {
      // Handle complex objects (like geographic areas, certifications, etc.)
      return JSON.stringify(answer, null, 2);
    }

    if (otherValue) {
      if (Array.isArray(otherValue)) {
        const filtered = otherValue.filter(v => v?.trim());
        if (filtered.length > 0) {
          return mainAnswer ? `${mainAnswer}, Other: ${filtered.join(', ')}` : `Other: ${filtered.join(', ')}`;
        }
      } else if (otherValue.trim()) {
        return mainAnswer ? `${mainAnswer}, Other: ${otherValue}` : `Other: ${otherValue}`;
      }
    }

    return mainAnswer || 'Not answered';
  };

  // Build grouped answers
  const groupedAnswers = QUESTIONS.reduce((acc, question) => {
    if (!acc[question.section]) {
      acc[question.section] = [];
    }
    
    const answer = formData[question.id];
    const otherValue = formData[`${question.id}_other`];
    
    acc[question.section].push({
      id: question.id,
      title: question.title,
      answer: formatAnswer(question.id, answer, otherValue),
      hasConditional: question.conditionalChildren && answer === 'yes'
    });

    // Add conditional children if parent is 'yes'
    if (question.conditionalChildren && answer === 'yes') {
      question.conditionalChildren.forEach(child => {
        const childAnswer = formData[child.id];
        const childOther = formData[`${child.id}_other`];
        acc[question.section].push({
          id: child.id,
          title: child.title,
          answer: formatAnswer(child.id, childAnswer, childOther),
          isChild: true
        });
      });
    }

    return acc;
  }, {});

  // Build HTML content with styling
  let htmlContent = `
    <div style="font-family: system-ui, -apple-system, sans-serif; color: #1e293b; line-height: 1.6;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 30px; border-radius: 12px; margin-bottom: 30px; color: white;">
        <h1 style="margin: 0 0 10px 0; font-size: 28px; font-weight: bold;">Website Content Questionnaire</h1>
        <p style="margin: 0; font-size: 16px; opacity: 0.95;">MSP Success - Pro Service</p>
      </div>

      <!-- Business Information -->
      <div style="background: #eff6ff; border: 2px solid #bfdbfe; border-radius: 12px; padding: 20px; margin-bottom: 30px;">
        <h2 style="margin: 0 0 15px 0; font-size: 20px; font-weight: 600; color: #1e3a8a;">Business Information</h2>
        <div style="margin-bottom: 10px;">
          <span style="font-weight: 600; color: #475569;">Business Name:</span>
          <span style="margin-left: 8px; color: #1e293b;">${businessName}</span>
        </div>
        <div style="margin-bottom: 10px;">
          <span style="font-weight: 600; color: #475569;">Domain:</span>
          <span style="margin-left: 8px; color: #1e293b;">${domain}</span>
        </div>
        <div>
          <span style="font-weight: 600; color: #475569;">Submission Date:</span>
          <span style="margin-left: 8px; color: #1e293b;">${new Date().toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          })}</span>
        </div>
      </div>
  `;

  // Add sections
  Object.entries(groupedAnswers).forEach(([sectionName, questions]) => {
    htmlContent += `
      <div style="margin-bottom: 30px;">
        <h2 style="font-size: 20px; font-weight: 600; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 15px;">
          ${sectionName}
        </h2>
    `;

    questions.forEach((q) => {
      const isChild = q.isChild;
      const marginLeft = isChild ? '30px' : '0';
      const borderLeft = isChild ? '3px solid #3b82f6' : 'none';
      const paddingLeft = isChild ? '15px' : '0';

      htmlContent += `
        <div style="background: #f8fafc; border-radius: 8px; padding: 15px; margin-bottom: 12px; margin-left: ${marginLeft}; border-left: ${borderLeft}; padding-left: ${paddingLeft};">
          <div style="font-size: 14px; font-weight: 600; color: #475569; margin-bottom: 6px;">
            Question ${q.id}: ${q.title}
          </div>
          <div style="font-size: 14px; color: #64748b; word-wrap: break-word; white-space: pre-wrap;">
            ${q.answer}
          </div>
        </div>
      `;
    });

    htmlContent += `</div>`;
  });

  htmlContent += `
      <!-- Footer -->
      <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #e2e8f0; text-align: center; color: #64748b; font-size: 12px;">
        <p style="margin: 0;">Generated by MSP Success - Pro Website Content Questionnaire</p>
        <p style="margin: 5px 0 0 0;">${new Date().toLocaleString('en-US')}</p>
      </div>
    </div>
  `;

  container.innerHTML = htmlContent;

  try {
    // Convert HTML to canvas
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff'
    });

    // Calculate PDF dimensions
    const imgWidth = 210; // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;

    // Create PDF
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgData = canvas.toDataURL('image/png');

    // Add first page
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    // Add additional pages if needed
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    // Download PDF
    pdf.save(filename);

    return { success: true, filename };
  } catch (error) {
    console.error('Error generating PDF:', error);
    return { success: false, error: error.message };
  } finally {
    // Clean up
    document.body.removeChild(container);
  }
};

// React component for rendering PDF content (for preview purposes)
export default function PDFGenerator() {
  return null; // This is a utility component, no UI needed
}