'use client';

import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface MarkdownViewProps {
  content: string;
}

export function MarkdownView({ content }: MarkdownViewProps) {
  // Split content into blocks: code blocks vs text blocks
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className="markdown-content">
      {blocks.map((block, idx) => {
        if (block.type === 'code') {
          return (
            <CodeBlockView
              key={idx}
              language={block.language || 'text'}
              code={block.content}
            />
          );
        } else if (block.type === 'list') {
          return (
            <ul key={idx} className="md-list">
              {block.items?.map((item, itemIdx) => (
                <li key={itemIdx}>
                  <InlineMarkdown text={item} />
                </li>
              ))}
            </ul>
          );
        } else if (block.type === 'ordered-list') {
          return (
            <ol key={idx} className="md-ordered-list">
              {block.items?.map((item, itemIdx) => (
                <li key={itemIdx}>
                  <InlineMarkdown text={item} />
                </li>
              ))}
            </ol>
          );
        } else if (block.type === 'quote') {
          return (
            <blockquote key={idx} className="md-blockquote">
              <InlineMarkdown text={block.content} />
            </blockquote>
          );
        } else {
          return (
            <p key={idx} className="md-paragraph">
              <InlineMarkdown text={block.content} />
            </p>
          );
        }
      })}
    </div>
  );
}

function CodeBlockView({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="code-block-container">
      <div className="code-block-header">
        <span className="code-block-lang">{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="code-copy-btn"
          aria-label="Copy code to clipboard"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check size={14} className="text-success" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy size={14} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

interface ParsedBlock {
  type: 'paragraph' | 'code' | 'list' | 'ordered-list' | 'quote';
  content: string;
  language?: string;
  items?: string[];
}

function parseMarkdownBlocks(rawText: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = rawText.split(/\r?\n/);
  let inCodeBlock = false;
  let codeLang = '';
  let codeBuffer: string[] = [];
  let currentListItems: string[] = [];
  let isOrderedList = false;
  let textBuffer: string[] = [];

  const flushTextBuffer = () => {
    if (textBuffer.length > 0) {
      const joined = textBuffer.join('\n').trim();
      if (joined) {
        blocks.push({ type: 'paragraph', content: joined });
      }
      textBuffer = [];
    }
  };

  const flushList = () => {
    if (currentListItems.length > 0) {
      blocks.push({
        type: isOrderedList ? 'ordered-list' : 'list',
        content: '',
        items: [...currentListItems],
      });
      currentListItems = [];
      isOrderedList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block fences
    if (line.trim().startsWith('```')) {
      if (!inCodeBlock) {
        flushTextBuffer();
        flushList();
        inCodeBlock = true;
        codeLang = line.trim().slice(3).trim();
        codeBuffer = [];
      } else {
        inCodeBlock = false;
        blocks.push({
          type: 'code',
          content: codeBuffer.join('\n'),
          language: codeLang || 'text',
        });
        codeBuffer = [];
        codeLang = '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Blockquote
    if (line.trim().startsWith('>')) {
      flushTextBuffer();
      flushList();
      const quoteText = line.replace(/^\s*>\s?/, '');
      blocks.push({ type: 'quote', content: quoteText });
      continue;
    }

    // Unordered list (- or *)
    const unorderedMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (unorderedMatch) {
      flushTextBuffer();
      if (isOrderedList) flushList();
      isOrderedList = false;
      currentListItems.push(unorderedMatch[1]);
      continue;
    }

    // Ordered list (1. 2.)
    const orderedMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushTextBuffer();
      if (!isOrderedList && currentListItems.length > 0) flushList();
      isOrderedList = true;
      currentListItems.push(orderedMatch[1]);
      continue;
    }

    // Blank line separating paragraphs
    if (line.trim() === '') {
      flushTextBuffer();
      flushList();
      continue;
    }

    // Regular line in paragraph
    flushList();
    textBuffer.push(line);
  }

  // Final flush
  if (inCodeBlock) {
    blocks.push({
      type: 'code',
      content: codeBuffer.join('\n'),
      language: codeLang || 'text',
    });
  } else {
    flushList();
    flushTextBuffer();
  }

  return blocks;
}

// Inline renderer that handles bold, italic, inline code, and links securely
function InlineMarkdown({ text }: { text: string }) {
  const tokens = tokenizeInline(text);

  return (
    <>
      {tokens.map((token, index) => {
        if (token.type === 'code') {
          return (
            <code key={index} className="inline-code">
              {token.content}
            </code>
          );
        } else if (token.type === 'bold') {
          return (
            <strong key={index} className="font-semibold">
              <InlineMarkdown text={token.content} />
            </strong>
          );
        } else if (token.type === 'italic') {
          return (
            <em key={index} className="italic">
              <InlineMarkdown text={token.content} />
            </em>
          );
        } else if (token.type === 'link') {
          // Verify safe protocol to prevent javascript: or data: injection
          const isSafeUrl = /^https?:\/\//i.test(token.url || '');
          if (!isSafeUrl) {
            return <span key={index}>{token.content}</span>;
          }
          return (
            <a
              key={index}
              href={token.url}
              target="_blank"
              rel="noopener noreferrer"
              className="md-link"
            >
              {token.content}
            </a>
          );
        } else {
          return <span key={index}>{token.content}</span>;
        }
      })}
    </>
  );
}

interface InlineToken {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link';
  content: string;
  url?: string;
}

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Inline code `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      tokens.push({ type: 'code', content: codeMatch[1] });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Markdown link [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      tokens.push({
        type: 'link',
        content: linkMatch[1],
        url: linkMatch[2],
      });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Bold **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      tokens.push({ type: 'bold', content: boldMatch[1] });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic *text*
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      tokens.push({ type: 'italic', content: italicMatch[1] });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Regular character accumulation
    const nextSpecial = remaining.search(/[`*\[]/);
    if (nextSpecial === -1) {
      tokens.push({ type: 'text', content: remaining });
      break;
    } else if (nextSpecial === 0) {
      tokens.push({ type: 'text', content: remaining[0] });
      remaining = remaining.slice(1);
    } else {
      tokens.push({ type: 'text', content: remaining.slice(0, nextSpecial) });
      remaining = remaining.slice(nextSpecial);
    }
  }

  return tokens;
}
