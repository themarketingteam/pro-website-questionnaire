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
      <div className="relative px-6 py-16 md:py-20">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
            Website Content Questionnaire
          </h1>
          <p className="mt-3 text-blue-100 text-lg">
            Help us get to know your business.
          </p>
        </div>
      </div>
    </div>
  );
}