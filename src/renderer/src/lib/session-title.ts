const MODE_LABELS: Record<string, string> = {
  'write-paper': '论文写作',
  'review-paper': '论文审阅',
};

/** Build a readable task title from the composed prompt instead of exposing commands or file paths. */
export function sessionTitleFromPrompt(prompt: string, maxLength = 28): string {
  const command = prompt.trim().match(/^\/([\w-]+)(?:\s+|$)/)?.[1] ?? '';
  let text = prompt
    .replace(/^\s*\/[\w-]+(?:\s+|$)/, '')
    .split(/(?:^|\n)\s*参考以下文件[：:]\s*/u, 1)[0]
    .replace(/<pasted_text>[\s\S]*$/u, '')
    .trim();

  const firstMeaningful = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line && !/^[-*]\s+[A-Za-z]:[\\/]/u.test(line));
  text = firstMeaningful ?? '';
  if (!text) return MODE_LABELS[command] ?? '新任务';
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}
