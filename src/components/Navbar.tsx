import React from 'react';
import type { LLMModel } from '../services/ai';
import { Settings, LogOut } from 'lucide-react';

const GithubIcon = ({ size = 16 }: { size?: number }) => (
  <svg height={size} width={size} viewBox="0 0 16 16" fill="currentColor" style={{ display: 'inline-block' }}>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

interface NavbarProps {
  currentModel: LLMModel;
  onModelChange: (model: LLMModel) => void;
  onOpenSettings: () => void;
  isMockMode: boolean;
  userAvatar: string;
  username: string;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ 
  currentModel, 
  onModelChange, 
  onOpenSettings,
  isMockMode,
  userAvatar,
  username,
  onLogout
}) => {
  return (
    <header style={{
      background: 'var(--bg-sidebar)',
      borderBottom: '1px solid var(--border-color)',
      padding: '0.8rem 2rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 50,
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)'
    }}>
      {/* Title Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }} onClick={() => window.location.reload()}>
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '8px',
          background: 'linear-gradient(135deg, var(--color-accent) 0%, #A5B4FC 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#FFF',
          fontWeight: 800,
          fontSize: '1rem',
          boxShadow: '0 0 15px rgba(99, 102, 241, 0.4)'
        }}>
          G
        </div>
        <span style={{ fontSize: '1.2rem', fontWeight: 700, letterSpacing: '-0.02em', fontFamily: 'var(--font-display)' }}>
          Git<span style={{ color: 'var(--color-accent)' }}>Report</span> Analyzer
        </span>
      </div>

      {/* Action panel Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        
        {/* Model Selection Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Model:</span>
          <select 
            value={currentModel}
            onChange={(e) => onModelChange(e.target.value as LLMModel)}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              padding: '0.4rem 0.8rem',
              fontSize: '0.85rem',
              color: 'var(--text-primary)',
              outline: 'none',
              cursor: 'pointer',
              transition: 'border-color 0.2s',
              fontFamily: 'var(--font-sans)',
              fontWeight: 500
            }}
            onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--border-color-glow)'}
            onMouseOut={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
          >
            <option value="local-llama" style={{ background: '#0B0F19' }}>🦙 Local LLaMA (Free)</option>
            <option value="gemini" style={{ background: '#0B0F19' }}>♊ Gemini Flash</option>
            <option value="openai" style={{ background: '#0B0F19' }}>🤖 OpenAI GPT-4o</option>
            <option value="anthropic" style={{ background: '#0B0F19' }}>🛡️ Anthropic Claude</option>
          </select>
        </div>

        {/* Settings button */}
        <button 
          onClick={onOpenSettings}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            background: 'rgba(255,255,255,0.03)',
            color: 'var(--text-secondary)'
          }}
          onMouseOver={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-color-glow)'; }}
          onMouseOut={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
          title="Configure Connections & AI Models"
        >
          <Settings size={18} />
        </button>

        {/* User auth details / login indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', borderLeft: '1px solid var(--border-color)', paddingLeft: '1.25rem' }}>
          {isMockMode ? (
            <button 
              onClick={onOpenSettings}
              className="btn btn-secondary"
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', gap: '0.4rem' }}
            >
              <GithubIcon size={14} /> Connect GitHub
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <img 
                src={userAvatar || 'https://avatars.githubusercontent.com/u/9919?v=4'} 
                alt="user-avatar" 
                style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1px solid var(--color-accent)' }}
              />
              <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)' }}>{username}</span>
              <button 
                onClick={onLogout}
                style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
                title="Logout"
                onMouseOver={(e) => e.currentTarget.style.color = 'var(--color-failure)'}
                onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                <LogOut size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
