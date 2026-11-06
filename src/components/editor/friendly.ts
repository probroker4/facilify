const KNOWN: Record<string, string> = {
  NAME: 'Student name',
  EVENT: 'Event name',
  ACHIEVEMENT: 'Achievement',
  CERTIFICATE_TYPE: 'Award name',
  DATE: 'Date',
  ID: 'Student ID',
  VERIFY_CODE: 'Verification code',
};

export function friendlyField(name: string): string {
  if (KNOWN[name]) return KNOWN[name];
  const words = name.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

export function friendlyText(content: string): string {
  const t = content.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, n: string) => `[${friendlyField(n)}]`).trim();
  return t || 'Empty box';
}
