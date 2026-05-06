import React from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

const getSelectionState = ({ total, minTotal, maxTotal }) => {
  const isTooLow = total < minTotal;
  const isTooHigh = total > maxTotal;
  const isValid = !isTooLow && !isTooHigh;

  if (isValid) {
    return {
      isValid,
      isTooLow,
      isTooHigh,
      icon: CheckCircle2,
      iconClassName: 'text-[#90C944]',
      emphasisClassName: 'text-[#6AA72F]',
      borderClassName: 'border-[#90C944]',
      backgroundClassName: 'bg-[#90C944]/[0.02]',
      progressClassName: 'bg-[#90C944]',
      helperTitleClassName: 'text-[#122947]',
      inlineStatusMessage: 'Your selections are within the recommended range.',
      desktopStatusMessage: 'Your selections are within the required range.'
    };
  }

  if (isTooLow) {
    const missing = minTotal - total;

    return {
      isValid,
      isTooLow,
      isTooHigh,
      icon: AlertCircle,
      iconClassName: 'text-[#F29100]',
      emphasisClassName: 'text-[#D37E00]',
      borderClassName: 'border-[#F29100]',
      backgroundClassName: 'bg-[#F29100]/[0.02]',
      progressClassName: 'bg-[#F29100]',
      helperTitleClassName: 'text-[#122947]',
      inlineStatusMessage: `Add ${missing} more selection${missing === 1 ? '' : 's'} across Services, Industries, or Locations.`,
      desktopStatusMessage: `Add ${missing} more selection${missing === 1 ? '' : 's'} to reach the minimum.`
    };
  }

  const excess = total - maxTotal;

  return {
    isValid,
    isTooLow,
    isTooHigh,
    icon: AlertCircle,
    iconClassName: 'text-red-600',
    emphasisClassName: 'text-red-700',
    borderClassName: 'border-red-200',
    backgroundClassName: 'bg-red-50/20',
    progressClassName: 'bg-red-600',
    helperTitleClassName: 'text-[#122947]',
    inlineStatusMessage: `Remove ${excess} selection${excess === 1 ? '' : 's'} to stay within the limit.`,
    desktopStatusMessage: `Remove ${excess} selection${excess === 1 ? '' : 's'} to stay within the limit.`
  };
};

const getProgressWidth = (total, maxTotal) => {
  if (!maxTotal) return 0;
  return Math.min((total / maxTotal) * 100, 100);
};

function InlineIndicator({
  total,
  minTotal,
  maxTotal,
  servicesCount,
  industriesCount,
  regionsCount,
  state,
  className
}) {
  const StatusIcon = state.icon;

  return (
    <div
      className={cn(
        'p-4 rounded border-2',
        state.backgroundClassName,
        state.borderClassName,
        className
      )}
    >
      <div className="flex items-start gap-3">
        <StatusIcon className={cn('w-5 h-5 mt-0.5', state.iconClassName)} />
        <div className="flex-1">
          <p className="font-semibold">
            <span className="text-black">Selection Balance:</span>
            <span className={state.emphasisClassName}>
              {' '}{total} / {maxTotal} (minimum {minTotal})
            </span>
          </p>
          <div aria-live="polite">
            <p className={cn('text-sm mt-1', state.emphasisClassName)}>
              {state.inlineStatusMessage}
            </p>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-sm">
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

function DesktopHelperIndicator({
  total,
  minTotal,
  maxTotal,
  servicesCount,
  industriesCount,
  regionsCount,
  state,
  className,
  showExplainer,
  showPointer,
  stickyMode
}) {
  const StatusIcon = state.icon;
  const progressWidth = getProgressWidth(total, maxTotal);
  const pointerStyle = state.isValid
    ? { backgroundColor: '#f7fee7', borderColor: '#90C944' }
    : state.isTooLow
      ? { backgroundColor: '#fff7ed', borderColor: '#F29100' }
      : { backgroundColor: '#fef2f2', borderColor: '#fecaca' };

  return (
    <div className={cn('relative overflow-visible', stickyMode && 'lg:sticky lg:top-6', className)}>
      {showPointer && (
        <div
          aria-hidden="true"
          className="hidden lg:block absolute -left-[9px] top-6 h-4 w-4 rotate-45 border-l border-b"
          style={pointerStyle}
        />
      )}

      <div
        className={cn(
          'relative overflow-visible rounded-2xl border bg-white shadow-[0_12px_32px_rgba(18,41,71,0.08)] p-5',
          state.borderClassName,
          state.backgroundClassName
        )}
      >
        <div className="flex items-start gap-3">
          <div className={cn(
            'mt-0.5 flex h-10 w-10 items-center justify-center rounded-full',
            state.isValid
              ? 'bg-[#90C944]/15'
              : state.isTooLow
                ? 'bg-[#F29100]/15'
                : 'bg-red-100'
          )}>
            <StatusIcon className={cn('w-5 h-5', state.iconClassName)} />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold tracking-[0.02em] text-[#122947]">
              Selection Balance
            </p>
            <p className="mt-1 text-2xl font-bold text-[#122947]">
              {total} / {maxTotal} selected
            </p>
            <p className="mt-1 text-sm text-[#566C75]">Minimum {minTotal} required</p>
          </div>
        </div>

        <div aria-live="polite" className="mt-4">
          <p className={cn('text-sm font-medium', state.emphasisClassName)}>
            {state.desktopStatusMessage}
          </p>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-[#566C75]">
          Your service, industry, and location choices help determine which pages and SEO opportunities are included in the final website. Don't worry you can always request other selections later, these today will help us prioritize your primary choices.
        </p>

        <div className="mt-4">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-label={`Selection progress: ${total} of ${maxTotal} selected`}
            aria-valuemin={0}
            aria-valuemax={maxTotal}
            aria-valuenow={Math.min(total, maxTotal)}
          >
            <div
              className={cn('h-full rounded-full transition-all duration-300', state.progressClassName)}
              style={{ width: `${progressWidth}%` }}
            />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
            <span className="font-medium text-[#566C75]">Services</span>
            <span className="font-bold text-[#122947]">{servicesCount}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
            <span className="font-medium text-[#566C75]">Industries</span>
            <span className="font-bold text-[#122947]">{industriesCount}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
            <span className="font-medium text-[#566C75]">Locations</span>
            <span className="font-bold text-[#122947]">{regionsCount}</span>
          </div>
        </div>

        {showExplainer && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 text-[#1E6BA8]" />
              <p className="text-sm leading-relaxed text-[#566C75]">
                Recommended spread: choose enough across all three areas so the final site has a useful mix of service, industry, and location content.
              </p>
            </div>
          </div>
        )}

        <p className="mt-4 text-xs text-[#566C75]">
          Selections update automatically as you click.
        </p>
      </div>
    </div>
  );
}

export default function SelectionSpanIndicator({
  servicesCount,
  industriesCount,
  regionsCount,
  minTotal = 8,
  maxTotal = 25,
  variant = 'inline',
  className = '',
  showExplainer = false,
  showPointer = false,
  stickyMode = false
}) {
  const total = servicesCount + industriesCount + regionsCount;
  const state = getSelectionState({ total, minTotal, maxTotal });

  if (variant === 'desktopHelper') {
    return (
      <DesktopHelperIndicator
        total={total}
        minTotal={minTotal}
        maxTotal={maxTotal}
        servicesCount={servicesCount}
        industriesCount={industriesCount}
        regionsCount={regionsCount}
        state={state}
        className={className}
        showExplainer={showExplainer}
        showPointer={showPointer}
        stickyMode={stickyMode}
      />
    );
  }

  return (
    <InlineIndicator
      total={total}
      minTotal={minTotal}
      maxTotal={maxTotal}
      servicesCount={servicesCount}
      industriesCount={industriesCount}
      regionsCount={regionsCount}
      state={state}
      className={className}
    />
  );
}