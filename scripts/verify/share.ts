import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CERTFLOW_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'certflow-share-'));

const caseName = process.argv[process.argv.indexOf('--case') + 1];
const BASE = 'https://certflow.example.com';
function assert(c: unknown, msg: string): asserts c {
  if (!c) { console.error('ASSERT FAILED: ' + msg); process.exit(1); }
}
function eq<T>(a: T, b: T, msg: string) { assert(a === b, `${msg}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); }

interface Rec { name: string; event: string; award: string; date: string; code: string }
function loadFixture(): Rec[] {
  const lines = fs.readFileSync(path.join(process.cwd(), 'fixtures/share/clean25.csv'), 'utf8').trim().split(/\r?\n/).slice(1);
  return lines.map((l) => {
    const cells: string[] = []; let cur = ''; let q = false;
    for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch; }
    cells.push(cur);
    return { name: cells[0], event: cells[1], award: cells[2], date: cells[3], code: cells[4] };
  });
}
const verifyUrl = (code: string) => `${BASE}/verify/${code}`;

async function main() {
  const S = await import('../../src/lib/share/index');
  const recs = loadFixture();
  assert(recs.length === 25, 'fixture has 25 rows');

  if (caseName === 'add-to-profile') {
    const ym = S.issueYearMonth;
    const fb = new Date(Date.UTC(2020, 6, 1));
    for (const d of ['2026-03-05', '05/03/2026', '5 March 2026', 'March 5, 2026', '2026-03-05T00:00:00.000Z', '2026-03-05 00:00:00', '5 Mar 2026', '46086']) {
      const r = ym(d, fb);
      assert(r.year === 2026 && r.month === 3, `date "${d}" -> ${JSON.stringify(r)}`);
    }
    for (const d of ['', undefined, 'garbage', 'Marvelous 2026x', '2026-13-01']) {
      const r = ym(d, fb);
      assert(r.year === 2020 && r.month === 7, `fallback for "${d}" -> ${JSON.stringify(r)}`);
    }
    for (const r of recs) {
      const { year, month } = ym(r.date, fb);
      const url = S.linkedInAddToProfileUrl({
        name: r.award, organizationName: r.event + ' & Org', issueYear: year, issueMonth: month,
        certUrl: verifyUrl(r.code), certId: r.code,
      });
      assert(url.startsWith('https://www.linkedin.com/profile/add?'), 'base url');
      const u = new URL(url); const p = u.searchParams;
      eq(p.get('startTask'), 'CERTIFICATION_NAME', 'startTask');
      eq(p.get('name'), r.award, 'name');
      eq(p.get('organizationName'), r.event + ' & Org', 'org');
      eq(p.get('organizationId'), null, 'no org id');
      eq(p.get('issueYear'), '2026', 'year');
      eq(p.get('issueMonth'), '3', 'month');
      eq(p.get('certId'), r.code, 'certId');
      eq(p.get('certUrl'), verifyUrl(r.code), 'certUrl');
      assert(!url.includes(' ') && !url.includes('&Org'), 'encoded');
      for (const o of recs) if (o.code !== r.code) assert(!url.includes(o.code), `other code ${o.code} leaked into ${r.code}`);
    }
    const withId = new URL(S.linkedInAddToProfileUrl({ name: 'X', organizationName: 'Y', organizationId: '12345', issueYear: 2026, issueMonth: 3, certUrl: 'u', certId: 'c' })).searchParams;
    eq(withId.get('organizationId'), '12345', 'org id');
    eq(withId.get('organizationName'), null, 'no org name when id');
    console.log('SHARE ADD TO PROFILE OK');
  } else if (caseName === 'share-post') {
    for (const r of recs) {
      const url = S.linkedInShareUrl(verifyUrl(r.code));
      assert(url.startsWith('https://www.linkedin.com/sharing/share-offsite/?url='), 'share base');
      eq(new URL(url).searchParams.get('url'), verifyUrl(r.code), 'share url decodes');
      const imageUrl = `${BASE}/api/verify/${r.code}/image`;
      const md = S.verifyPageMetadata({ name: r.name, event: r.event, award: r.award, issuer: 'Org', verifyUrl: verifyUrl(r.code), imageUrl });
      assert(md.openGraph.title && md.openGraph.title.includes(r.name), 'og:title has name');
      eq(md.openGraph.images[0].url, imageUrl, 'og:image');
      assert(md.openGraph.images[0].url.endsWith(`/api/verify/${r.code}/image`), 'og:image path');
      eq(md.openGraph.url, verifyUrl(r.code), 'og:url');
      assert(md.openGraph.images[0].width > 0 && md.openGraph.images[0].height > 0 && md.openGraph.images[0].alt, 'image dims/alt');
      eq(md.twitter.images[0], imageUrl, 'twitter image');
      assert(md.description.includes(r.award), 'description');
    }
    console.log('SHARE POST OK');
  } else if (caseName === 'customize') {
    const r = recs[4];
    const base = { title: r.award, organizationName: r.event, dateText: r.date, issuedAt: new Date(), verifyUrl: verifyUrl(r.code), verifyCode: r.code, customizeUrl: `${BASE}/linkedin/tok` };
    const def = S.buildShareLinks(base);
    const edited = S.buildShareLinks({ ...base, title: 'Winner: "Best & Brightest" Hacker', postText: 'Proud to share my win! #hack 100% ' + verifyUrl(r.code) });
    const a = new URL(edited.addToProfile).searchParams;
    eq(a.get('name'), 'Winner: "Best & Brightest" Hacker', 'edited title in name');
    eq(a.get('certId'), r.code, 'code unchanged');
    eq(a.get('certUrl'), verifyUrl(r.code), 'cert url unchanged');
    eq(new URL(edited.post).searchParams.get('text'), 'Proud to share my win! #hack 100% ' + verifyUrl(r.code), 'post text');
    assert(edited.post.startsWith('https://www.linkedin.com/feed/?shareActive=true&text='), 'post base');
    eq(new URL(edited.share).searchParams.get('url'), verifyUrl(r.code), 'share unchanged');
    eq(edited.customize, base.customizeUrl, 'customize link');
    const d = new URL(def.addToProfile).searchParams;
    eq(d.get('name'), r.award, 'default title');
    for (const k of ['certId', 'certUrl', 'issueYear', 'issueMonth', 'organizationName']) eq(a.get(k), d.get(k), `${k} unaffected by edits`);
    assert(new URL(def.post).searchParams.get('text')!.includes(r.award), 'default post text');
    eq(def.share, edited.share, 'share link independent of edits');
    for (const v of Object.values(edited)) eq(typeof v, 'string', 'only strings returned');
    assert(!JSON.stringify(edited).match(/%PDF|pdf/i), 'no PDF data');
    console.log('SHARE CUSTOMIZE OK');
  } else {
    console.error('unknown --case ' + caseName); process.exit(2);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
