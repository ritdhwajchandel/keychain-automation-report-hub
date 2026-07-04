import React, { useState, useEffect, useRef } from 'react';
import { aiService } from '../services/ai';
import type { ChatMessage, LLMModel } from '../services/ai';
import type { WorkflowRunReport } from '../services/github';
import { MessageSquare, Send, Sparkles } from 'lucide-react';

interface AIChatProps {
  selectedRun: WorkflowRunReport;
  comparisonRun?: WorkflowRunReport;
  model: LLMModel;
}

export const AIChat: React.FC<AIChatProps> = ({ selectedRun, comparisonRun, model }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset chat when run or model changes, load initial welcome message
  useEffect(() => {
    const welcomeMessage = `👋 Hello! I am your AI Pipeline Analyst running under **${model.toUpperCase()}**. I've indexed **Run #${selectedRun.runNumber}** ${comparisonRun ? `and **Run #${comparisonRun.runNumber}**` : ''} for analysis.
    
Ask me anything about failures, performance hotspots, or differences between runs!`;
    
    setMessages([
      { role: 'assistant', content: welcomeMessage }
    ]);
  }, [selectedRun.id, comparisonRun?.id, model]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSend = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: ChatMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const replyText = await aiService.queryAI(
        model,
        text,
        [...messages, userMessage],
        selectedRun,
        comparisonRun
      );
      setMessages(prev => [...prev, { role: 'assistant', content: replyText }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ Failed to query AI model: ${e.message || e}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    handleSend(prompt);
  };

  return (
    <div className="card animate-fade-in" style={{
      display: 'flex',
      flexDirection: 'column',
      height: '560px',
      padding: '1.25rem',
      gap: '1rem',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <MessageSquare size={18} style={{ color: 'var(--color-accent)' }} />
          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>AI Pipeline Chat</h3>
        </div>
        <div style={{
          marginLeft: 'auto',
          fontSize: '0.7rem',
          color: 'var(--color-accent)',
          background: 'var(--surface-2)',
          padding: '0.2rem 0.6rem',
          borderRadius: '4px',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem'
        }}>
          <Sparkles size={10} /> Active: {model.replace('-', ' ').toUpperCase()}
        </div>
      </div>

      {/* Message List */}
      <div 
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          paddingRight: '0.25rem'
        }}
      >
        {messages.map((m, idx) => (
          <div 
            key={idx}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              background: m.role === 'user' ? 'var(--color-accent)' : 'var(--surface-2)',
              border: m.role === 'user' ? 'none' : '1px solid var(--border-color)',
              color: m.role === 'user' ? '#FFF' : 'var(--text-primary)',
              borderRadius: '8px',
              padding: '0.75rem 1rem',
              fontSize: '0.85rem',
              lineHeight: '1.45',
              whiteSpace: 'pre-wrap'
            }}
          >
            {m.content}
          </div>
        ))}
        {isLoading && (
          <div style={{
            alignSelf: 'flex-start',
            background: 'var(--surface-1)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <span style={{
              width: '6px',
              height: '6px',
              backgroundColor: 'var(--color-accent)',
              borderRadius: '50%',
              display: 'inline-block',
              animation: 'pulseGlow 1s infinite'
            }} />
            AI is analyzing reports...
          </div>
        )}
      </div>

      {/* Quick suggestions */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', overflowX: 'auto', paddingBottom: '0.25rem' }}>
        <button 
          onClick={() => handleQuickPrompt('List the test failures and explain their errors')}
          style={{
            fontSize: '0.75rem',
            padding: '0.35rem 0.75rem',
            borderRadius: '6px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-secondary)'
          }}
          onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--color-accent)'}
          onMouseOut={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
        >
          🔍 Explain failures
        </button>
        <button 
          onClick={() => handleQuickPrompt('Which test suites or runs were the slowest?')}
          style={{
            fontSize: '0.75rem',
            padding: '0.35rem 0.75rem',
            borderRadius: '6px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-secondary)'
          }}
          onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--color-accent)'}
          onMouseOut={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
        >
          ⚡ Slowest tests
        </button>
        {comparisonRun && (
          <button 
            onClick={() => handleQuickPrompt(`Compare active run ${selectedRun.runNumber} and run ${comparisonRun.runNumber} and list regressions`)}
            style={{
              fontSize: '0.75rem',
              padding: '0.35rem 0.75rem',
              borderRadius: '6px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)'
            }}
            onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--color-accent)'}
            onMouseOut={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
          >
            🔄 Compare runs
          </button>
        )}
      </div>

      {/* Inputs Form */}
      <form 
        onSubmit={(e) => { e.preventDefault(); handleSend(input); }}
        style={{ display: 'flex', gap: '0.5rem' }}
      >
        <input 
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about this run..."
          className="input-field"
          style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem' }}
          disabled={isLoading}
        />
        <button 
          type="submit" 
          className="btn"
          style={{ width: '40px', height: '40px', padding: 0, borderRadius: '8px' }}
          disabled={isLoading}
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
};
