import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  variant?: 'white' | 'carbon';
  className?: string;
  title?: string;
}

export function CopyButton({
  text,
  label = 'Copy Report',
  copiedLabel = 'Copied',
  variant = 'carbon',
  className = '',
  title,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable
    }
  };

  const styles = variant === 'white' ? 'sl-btn-white' : 'sl-btn-carbon';

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      title={title ?? `Copy ${label.toLowerCase()} to clipboard`}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] transition ${styles} ${className}`}
    >
      {copied ? (
        <Check
          className={`h-3.5 w-3.5 shrink-0 ${variant === 'white' ? 'text-emerald-600' : 'text-white'}`}
        />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 opacity-80" />
      )}
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
}
