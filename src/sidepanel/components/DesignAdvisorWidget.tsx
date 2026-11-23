import { Loader2, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { askDesignAdvisor, type AdvisorMessage } from '../../ai/designAdvisor';
import type { AiSettings, UiLanguage } from '../../storage/aiSettingsStore';
import type { CaptureRecord } from '../../types/capture';
import { getTranslations } from '../i18n/translations';

interface DesignAdvisorWidgetProps {
  open: boolean;
  onClose: () => void;
  record: CaptureRecord | null;
  aiSettings: AiSettings;
  language?: UiLanguage;
}

export function DesignAdvisorWidget({
  open,
  onClose,
  record,
  aiSettings,
  language = 'en',
}: DesignAdvisorWidgetProps) {
  const t = getTranslations(language);
  const [messages, setMessages] = useState<AdvisorMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: t.advisorGreeting,
      sourceLabel: t.advisorTitle,
    },
  ]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  // Update welcome greeting cleanly if user switches language
  useEffect(() => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === 'welcome' ? { ...m, text: t.advisorGreeting, sourceLabel: t.advisorTitle } : m
      )
    );
  }, [t.advisorGreeting, t.advisorTitle]);

  useEffect(() => {
    if (open) {
      scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open]);

  if (!open) return null;

  const submitQuestion = async (rawQuestion: string) => {
    const q = rawQuestion.trim();
    if (!q || thinking) return;

    const userMsg: AdvisorMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: q,
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput('');
    setThinking(true);

    try {
      const reply = await askDesignAdvisor({
        question: q,
        record,
        history: nextHistory,
        aiSettings,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: reply.text,
          sourceLabel: reply.sourceLabel,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: t.advisorError,
          sourceLabel: t.advisorTitle,
        },
      ]);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="fixed inset-x-3 bottom-14 top-16 z-40 flex flex-col overflow-hidden rounded-2xl border border-white/[0.14] bg-[#0e0e11]/98 shadow-2xl shadow-black/80 backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="sl-white-ring h-3 w-3 rounded-full" />
          <span className="text-[13.5px] font-semibold text-white">{t.advisorTitle}</span>
          {record && (
            <span className="max-w-[130px] truncate text-[11.5px] text-zinc-500">
              · {record.page.hostname}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-zinc-400 transition hover:bg-white/10 hover:text-white"
          title={t.close}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[90%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-white text-[#09090b] font-medium'
                  : 'border border-white/[0.08] bg-[#16161a] text-zinc-200'
              }`}
            >
              {msg.text}
            </div>
            {msg.sourceLabel && msg.role === 'assistant' && (
              <span className="mt-1 px-1 text-[10.5px] text-zinc-500">{msg.sourceLabel}</span>
            )}
          </div>
        ))}

        {thinking && (
          <div className="flex items-center gap-2 text-[12px] text-zinc-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
            <span>{t.advisorReviewing}</span>
          </div>
        )}
        <div ref={scrollEndRef} />
      </div>

      {/* Simple Quick Prompts */}
      <div className="flex flex-wrap gap-1.5 border-t border-white/[0.06] px-4 py-2.5">
        {t.advisorQuickAsks.map((q) => (
          <button
            key={q}
            type="button"
            disabled={thinking}
            onClick={() => void submitQuestion(q)}
            className="rounded-full border border-white/[0.1] bg-[#151519] px-3 py-1 text-[11.5px] text-zinc-300 transition hover:border-white/30 hover:text-white disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submitQuestion(input);
        }}
        className="flex items-center gap-2 border-t border-white/[0.08] bg-[#0b0b0d] p-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t.advisorPlaceholder}
          className="min-w-0 flex-1 rounded-lg border border-white/[0.12] bg-[#141418] px-3 py-2 text-[13px] text-white placeholder:text-zinc-500 focus:border-white/35 focus:outline-none"
        />
        <button
          type="submit"
          disabled={thinking || !input.trim()}
          className="sl-btn-white flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition disabled:opacity-35"
          title="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
