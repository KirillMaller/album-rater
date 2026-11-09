import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function safeMarkdownUrl(url: string) {
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:') || trimmed.startsWith('vbscript:')) return '';
  return url;
}

export default function MarkdownContent({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeMarkdownUrl}>{children}</ReactMarkdown>;
}
