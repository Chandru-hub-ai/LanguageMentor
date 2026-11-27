import React, { useState } from 'react';
import type { ProgrammingLanguage } from '../types';

interface CodeBlockProps {
  code: string;
  language?: string;
  onOpenInPlayground?: (code: string, lang: ProgrammingLanguage) => void;
}

const KEYWORD_SET = new Set([
  'function', 'const', 'let', 'var', 'return', 'if', 'else', 'elif', 'for', 'while',
  'class', 'public', 'private', 'static', 'void', 'int', 'double', 'float', 'boolean',
  'String', 'def', 'import', 'from', 'export', 'default', 'async', 'await', 'try',
  'catch', 'throw', 'new', 'true', 'false', 'null', 'None', 'True', 'False', 'SELECT',
  'FROM', 'WHERE', 'JOIN', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'CREATE', 'TABLE',
  'in', 'enumerate', 'range', 'print', 'System', 'out', 'println', 'console', 'log',
]);

const normalizeLang = (raw?: string): ProgrammingLanguage => {
  const s = (raw || '').toLowerCase().trim();
  if (s === 'py' || s === 'python') return 'python';
  if (s === 'java') return 'java';
  if (s === 'c') return 'c';
  if (s === 'cpp' || s === 'c++') return 'cpp';
  return 'javascript';
};

const highlightLine = (line: string): React.ReactNode[] => {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('--')) {
    return [
      <span key="cmt" className="text-zinc-500 italic">
        {line}
      </span>,
    ];
  }

  const tokens = line.split(/("[^"]*"|'[^']*'|`[^`]*`|\b[A-Za-z_][A-Za-z0-9_]*\b|\b\d+(?:\.\d+)?\b)/g);
  return tokens.map((tok, idx) => {
    if (!tok) return null;
    if (
      (tok.startsWith('"') && tok.endsWith('"')) ||
      (tok.startsWith("'") && tok.endsWith("'")) ||
      (tok.startsWith('`') && tok.endsWith('`'))
    ) {
      return (
        <span key={idx} className="text-[#39FF14]">
          {tok}
        </span>
      );
    }
    if (/^\d+(?:\.\d+)?$/.test(tok)) {
      return (
        <span key={idx} className="text-amber-300">
          {tok}
        </span>
      );
    }
    if (KEYWORD_SET.has(tok)) {
      return (
        <span key={idx} className="text-white font-semibold">
          {tok}
        </span>
      );
    }
    return <span key={idx} className="text-zinc-300">{tok}</span>;
  });
};

const CodeBlock: React.FC<CodeBlockProps> = ({ code, language, onOpenInPlayground }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const lines = code.replace(/\n$/, '').split('\n');
  const displayLang = (language || 'code').toUpperCase();

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-white/15 bg-[#050507] text-zinc-100">
      <div className="px-3.5 py-2 bg-white/[0.04] border-b border-white/10 flex items-center justify-between gap-2">
        <span className="text-[11px] font-mono font-semibold text-zinc-400 tracking-wider">
          {displayLang}
        </span>
        <div className="flex items-center gap-2">
          {onOpenInPlayground && (
            <button
              type="button"
              onClick={() => onOpenInPlayground(code, normalizeLang(language))}
              className="px-3 py-1 rounded-full bg-[#39FF14]/15 hover:bg-[#39FF14]/25 border border-[#39FF14]/35 text-[#39FF14] text-[11px] font-medium transition-colors flex items-center gap-1.5"
            >
              <i className="fa-solid fa-play text-[9px]"></i>
              <span>Open in Playground</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium transition-colors flex items-center gap-1.5"
          >
            <i className={`fa-solid ${copied ? 'fa-check text-[#39FF14]' : 'fa-copy'}`}></i>
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
      <div className="p-3.5 overflow-x-auto text-xs font-mono leading-relaxed">
        {lines.map((line, i) => (
          <div key={i} className="flex gap-4">
            <span className="select-none text-zinc-600 w-5 text-right shrink-0 tabular-nums">
              {i + 1}
            </span>
            <span className="whitespace-pre">{highlightLine(line)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CodeBlock;
