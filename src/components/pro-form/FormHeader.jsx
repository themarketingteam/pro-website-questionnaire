import React from 'react';

export default function FormHeader() {
  return (
    <div className="relative overflow-hidden">
      {/* Gradient Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600">
        {/* Decorative shapes */}
        <div className="absolute top-0 left-0 w-96 h-96 bg-blue-400/20 rounded-full -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-indigo-400/20 rounded-full translate-x-1/3 translate-y-1/3" />
        <div className="absolute top-1/2 left-1/4 w-64 h-64 bg-white/5 rounded-full" />
      </div>
      
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