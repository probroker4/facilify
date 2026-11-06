import type { LinkedInCert } from '@/lib/contracts';

export function linkedInAddToProfileUrl(c: LinkedInCert): string {
  const p = new URLSearchParams();
  p.set('startTask', 'CERTIFICATION_NAME');
  p.set('name', c.name);
  if (c.organizationId) p.set('organizationId', c.organizationId);
  else p.set('organizationName', c.organizationName);
  p.set('issueYear', String(c.issueYear));
  p.set('issueMonth', String(c.issueMonth));
  p.set('certUrl', c.certUrl);
  p.set('certId', c.certId);
  return `https://www.linkedin.com/profile/add?${p.toString()}`;
}

export function linkedInShareUrl(pageUrl: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`;
}

export function linkedInPostUrl(text: string): string {
  return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`;
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const validMonth = (n: number) => Number.isInteger(n) && n >= 1 && n <= 12;
const validYear = (n: number) => Number.isInteger(n) && n >= 1900 && n <= 2200;

export function issueYearMonth(dateText: string | undefined, fallback: Date): { year: number; month: number } {
  const fb = { year: fallback.getUTCFullYear(), month: fallback.getUTCMonth() + 1 };
  const t = (dateText ?? '').trim();
  if (!t) return fb;
  let m = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?!\d)/.exec(t);
  if (m && validYear(Number(m[1])) && validMonth(Number(m[2]))) return { year: Number(m[1]), month: Number(m[2]) };
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?!\d)/.exec(t);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    const month = b > 12 ? a : b;
    if (validMonth(month) && validYear(Number(m[3]))) return { year: Number(m[3]), month };
  }
  const yr = /(?:^|\D)(\d{4})(?!\d)/.exec(t);
  if (yr && validYear(Number(yr[1]))) {
    for (const tok of t.toLowerCase().match(/[a-z]+/g) ?? []) {
      if (tok.length < 3) continue;
      const idx = MONTH_NAMES.findIndex((n) => n === tok || (tok.length <= 4 && n.startsWith(tok)));
      if (idx >= 0) return { year: Number(yr[1]), month: idx + 1 };
    }
  }
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const d = new Date(Math.round((Number(t) - 25569) * 86400000));
    if (!Number.isNaN(d.getTime())) return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  }
  return fb;
}

export interface ShareLinks { addToProfile: string; share: string; post: string; customize: string }

export function buildShareLinks(input: {
  title: string; organizationName: string; organizationId?: string; dateText?: string; issuedAt: Date;
  verifyUrl: string; verifyCode: string; customizeUrl: string; postText?: string;
}): ShareLinks {
  const { year, month } = issueYearMonth(input.dateText, input.issuedAt);
  return {
    addToProfile: linkedInAddToProfileUrl({
      name: input.title, organizationName: input.organizationName, organizationId: input.organizationId,
      issueYear: year, issueMonth: month, certUrl: input.verifyUrl, certId: input.verifyCode,
    }),
    share: linkedInShareUrl(input.verifyUrl),
    post: linkedInPostUrl(input.postText ?? `I received "${input.title}" from ${input.organizationName}! ${input.verifyUrl}`),
    customize: input.customizeUrl,
  };
}

export function verifyPageMetadata(input: {
  name: string; event: string; award: string; issuer: string; verifyUrl: string; imageUrl: string;
}) {
  const title = `${input.award} - ${input.name} | ${input.event}`;
  const description = `${input.name} received "${input.award}" at ${input.event}, issued by ${input.issuer}. Verify this certificate.`;
  const alt = `Certificate: ${input.award} awarded to ${input.name}`;
  return {
    title,
    description,
    openGraph: {
      title, description, url: input.verifyUrl, type: 'website',
      images: [{ url: input.imageUrl, width: 1200, height: 630, alt }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [input.imageUrl] },
  };
}
