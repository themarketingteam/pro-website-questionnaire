import React from 'react';

export default function FormHeader() {
  return (
    <div className="relative overflow-hidden">
      {/* Background Image */}
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: 'url(https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6925fec3678942d22522b010/972142ef3_banner.jpg)'
        }}
      />
      
      {/* Content */}
      <div className="relative py-10 md:py-20">
        <div className="max-w-4xl mx-auto px-4 md:px-6 md:pl-16">
          <h1 className="text-xl sm:text-2xl md:text-4xl font-bold text-white tracking-tight leading-tight">
            MSP Success - Pro | Website Content Questionnaire
          </h1>
          <p className="mt-2 text-blue-100 text-base md:text-lg">
            Help us get to know your business.
          </p>
        </div>
      </div>
    </div>
  );
}