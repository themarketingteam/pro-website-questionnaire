import React from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

export default function SelectionSpanIndicator({ 
  servicesCount, 
  industriesCount, 
  regionsCount,
  minTotal = 8,
  maxTotal = 15
}) {
  const total = servicesCount + industriesCount + regionsCount;
  const isValid = total >= minTotal && total <= maxTotal;
  const isTooLow = total < minTotal;
  const isTooHigh = total > maxTotal;

  return (
    <div className={`p-4 rounded border-2 ${
      isValid 
        ? 'bg-[#90C944]/10 border-[#90C944]' 
        : isTooLow 
        ? 'bg-[#F29100]/10 border-[#F29100]'
        : 'bg-red-50 border-red-200'
    }`}>
      <div className="flex items-start gap-3">
        {isValid ? (
          <CheckCircle2 className="w-5 h-5 text-[#90C944] mt-0.5" />
        ) : (
          <AlertCircle className={`w-5 h-5 mt-0.5 ${isTooLow ? 'text-[#F29100]' : 'text-red-600'}`} />
        )}
        <div className="flex-1">
          <p className={`font-semibold ${
            isValid ? 'text-[#6AA72F]' : isTooLow ? 'text-[#D37E00]' : 'text-red-800'
          }`}>
            Selection Balance: {total} / {minTotal}-{maxTotal}
          </p>
          <p className={`text-sm mt-1 ${
            isValid ? 'text-[#6AA72F]' : isTooLow ? 'text-[#D37E00]' : 'text-red-700'
          }`}>
            {isValid 
              ? 'Your selections are within the optimal range.'
              : isTooLow
              ? `Add ${minTotal - total} more selection${minTotal - total > 1 ? 's' : ''} across Services, Industries, or Locations.`
              : `Remove ${total - maxTotal} selection${total - maxTotal > 1 ? 's' : ''} to stay within limits.`
            }
          </p>
          <div className="flex gap-4 mt-3 text-sm">
            <span className="text-[#566C75]">
              Services: <strong className="text-[#122947]">{servicesCount}</strong>
            </span>
            <span className="text-[#566C75]">
              Industries: <strong className="text-[#122947]">{industriesCount}</strong>
            </span>
            <span className="text-[#566C75]">
              Locations: <strong className="text-[#122947]">{regionsCount}</strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}