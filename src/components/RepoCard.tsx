import React from 'react';
import type { GitHubRepo } from '../services/github';
import { Star, GitFork, ArrowRight } from 'lucide-react';

interface RepoCardProps {
  repo: GitHubRepo;
  isBookmarked: boolean;
  onToggleBookmark: (repo: GitHubRepo) => void;
  onSelect: (repo: GitHubRepo) => void;
}

export const RepoCard: React.FC<RepoCardProps> = ({ repo, isBookmarked, onToggleBookmark, onSelect }) => {
  return (
    <div 
      className="card animate-fade-in"
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        height: '100%',
        minHeight: '160px',
        position: 'relative',
        cursor: 'pointer'
      }}
      onClick={() => onSelect(repo)}
    >
      {/* Top Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', maxWidth: '80%' }}>
            <img 
              src={repo.owner.avatarUrl} 
              alt={repo.owner.login}
              style={{ width: '20px', height: '20px', borderRadius: '4px' }}
            />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {repo.owner.login}
            </span>
          </div>
          
          {/* Star Button */}
          <button 
            onClick={(e) => {
              e.stopPropagation(); // Don't trigger card selection
              onToggleBookmark(repo);
            }}
            style={{
              color: isBookmarked ? 'var(--color-skipped)' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.25rem',
              borderRadius: '50%'
            }}
            onMouseOver={(e) => { if(!isBookmarked) e.currentTarget.style.color = 'var(--text-secondary)'; }}
            onMouseOut={(e) => { if(!isBookmarked) e.currentTarget.style.color = 'var(--text-muted)'; }}
            title={isBookmarked ? "Remove Bookmark" : "Add Bookmark"}
          >
            <Star size={16} fill={isBookmarked ? 'var(--color-skipped)' : 'transparent'} />
          </button>
        </div>

        <h3 style={{ fontSize: '1.15rem', color: 'white', marginBottom: '0.5rem', wordBreak: 'break-all' }}>
          {repo.name}
        </h3>
        
        <p style={{ 
          fontSize: '0.8rem', 
          color: 'var(--text-secondary)', 
          lineHeight: '1.4',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          marginBottom: '1rem',
          height: '2.8em'
        }}>
          {repo.description}
        </p>
      </div>

      {/* Footer stats */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTop: '1px solid var(--border-color)',
        paddingTop: '0.75rem',
        marginTop: 'auto'
      }}>
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Star size={12} /> {repo.stars}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <GitFork size={12} /> {repo.forks}
          </span>
        </div>
        
        <span style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: 'var(--color-accent)'
        }}>
          Analyze <ArrowRight size={12} />
        </span>
      </div>
    </div>
  );
};
