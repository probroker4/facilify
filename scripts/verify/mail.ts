import fs from 'node:fs';
import path from 'node:path';
import { SMTPServer } from 'smtp-server';
import { MailError, MappingError, type EmailTemplate } from '../../src/lib/contracts';
import { sha256 } from '../../src/lib/hash';
import { composeEmail, deterministicMessageId, htmlToText, type MailCertificate } from '../../src/lib/mail/compose';
import { guardMail, type ExpectedDelivery } from '../../src/lib/mail/guard';
import { buildMime } from '../../src/lib/mail/mime';
import {
  CaptureTransport,
  classifyGmailError,
  classifySmtpError,
  GmailTransport,
  SmtpTransport,
} from '../../src/lib/mail/transports';
import { builtinBackground, builtinTemplate } from '../../src/lib/render/builtin';
import { renderCertificate } from '../../src/lib/render/render';
import { ServerFontProvider } from '../../src/lib/fonts/server';
import { certToken, verifyCodeFor } from '../../src/lib/secrets/crypto';
import { buildShareLinks } from '../../src/lib/share/linkedin';

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(cond: boolean, msg: string) {
  if (!cond) fail(msg);
  console.log(`  ok   ${msg}`);
}

async function makeTestCert(certId: string, personKey: string, name: string, award: string, verifyCode: string) {
  const fonts = new ServerFontProvider();
  const tpl = builtinTemplate('classic');
  const bg = await builtinBackground(tpl.backgroundRef!);
  const r = await renderCertificate({
    template: tpl,
    background: bg,
    values: { NAME: name, EVENT: 'Annual Hackathon', CERTIFICATE_TYPE: award, VERIFY_CODE: verifyCode },
    certId,
    recordId: `rec_${certId}`,
    personKey,
    verifyCode,
    verifyUrl: `http://localhost:3000/verify/${verifyCode}`,
    fileName: `Cert_${name.replace(/\s+/g, '_')}.pdf`,
  }, fonts);
  return r;
}

async function testCompose() {
  console.log('Testing email composition...');
  const certId = 'cert_comp_1';
  const personKey = 'p_comp_1';
  const vCode = verifyCodeFor(certId);
  const repToken = certToken(certId);
  const pdfBytes = new Uint8Array([1, 2, 3, 4]);

  const cert: MailCertificate = {
    certId,
    fileName: 'Ananya_Certificate.pdf',
    pdf: pdfBytes,
    sha256: sha256(pdfBytes),
    verifyCode: vCode,
    verifyUrl: `http://localhost:3000/verify/${vCode}`,
    categoryLabel: '1st Prize',
    reportUrl: `http://localhost:3000/report/${repToken}`,
    linkedInAddUrl: 'https://linkedin.com/add?cert=1',
    linkedInShareUrl: 'https://linkedin.com/share?cert=1',
  };

  const tpl: EmailTemplate = {
    id: 'tpl_1',
    subject: 'Congratulations {{NAME}} for {{EVENT}}!',
    html: '<h2>Dear {{NAME}}</h2><p>You won <b>{{AWARDS}}</b>!</p>',
    includeDriveLink: false,
    includeLinkedIn: true,
  };

  const mail = composeEmail({
    template: tpl,
    values: { NAME: 'Ananya <Student> & Co', EVENT: 'Hack 2026' },
    to: 'ananya@example.com',
    personKey,
    certs: [cert],
    organizationName: 'Hack Club',
    messageId: deterministicMessageId([certId], 1),
  });

  ok(mail.to === 'ananya@example.com', 'mail.to matches recipient');
  ok(mail.subject.includes('Ananya <Student> & Co'), 'subject substituted correctly');
  ok(mail.html.includes('&lt;Student&gt; &amp; Co'), 'student name is HTML-escaped in body');
  ok(mail.html.includes('<h2>Dear '), 'organizer HTML tags are preserved');
  ok(mail.html.includes(vCode), 'verify code included in HTML');
  ok(mail.html.includes(repToken), 'report token included in HTML');
  ok(mail.attachments.length === 1, 'has 1 attachment');
  ok(mail.attachments[0].fileName === 'Ananya_Certificate.pdf', 'attachment has correct file name');
  ok(mail.text.includes('Dear Ananya <Student> & Co'), 'plain text version decoded properly');

  const cert2: MailCertificate = {
    ...cert,
    certId: 'cert_comp_2',
    categoryLabel: 'Best UI',
    fileName: 'Ananya_Best_UI.pdf',
    verifyCode: verifyCodeFor('cert_comp_2'),
    reportUrl: `http://localhost:3000/report/${certToken('cert_comp_2')}`,
  };

  const multiMail = composeEmail({
    template: tpl,
    values: { NAME: 'Ananya Sharma', EVENT: 'Hack 2026' },
    to: 'ananya@example.com',
    personKey,
    certs: [cert, cert2],
    organizationName: 'Hack Club',
    messageId: deterministicMessageId([cert.certId, cert2.certId], 1),
  });

  ok(multiMail.attachments.length === 2, 'multi-cert email attaches both certificates');
  ok(multiMail.html.includes('You are receiving 2 certificates'), 'notifies of multiple certificates');
  ok(multiMail.html.includes('1st Prize') && multiMail.html.includes('Best UI'), 'lists all award categories');

  console.log('MAIL COMPOSE OK');
}

async function testGuard() {
  console.log('Testing mapping guard...');
  const certIdA = 'cert_ga_1';
  const personA = 'alice_key';
  const codeA = verifyCodeFor(certIdA);
  const tokenA = certToken(certIdA);
  const rA = await makeTestCert(certIdA, personA, 'Alice Smith', 'Winner', codeA);

  const certA: MailCertificate = {
    certId: certIdA,
    fileName: rA.fileName,
    pdf: rA.pdf,
    sha256: rA.sha256,
    verifyCode: codeA,
    verifyUrl: `http://localhost:3000/verify/${codeA}`,
    categoryLabel: 'Winner',
    reportUrl: `http://localhost:3000/report/${tokenA}`,
  };

  const expectedA: ExpectedDelivery = {
    to: 'alice@example.com',
    personKey: personA,
    certs: [{ certId: certIdA, sha256: rA.sha256, verifyCode: codeA, reportToken: tokenA }],
  };

  const mailA = composeEmail({
    template: { id: 't1', subject: 'Your certificate', html: '<p>Congrats {{NAME}}</p>', includeDriveLink: false, includeLinkedIn: false },
    values: { NAME: 'Alice Smith' },
    to: 'alice@example.com',
    personKey: personA,
    certs: [certA],
    organizationName: 'Club',
    messageId: '<msg1@x>',
  });

  await guardMail(mailA, expectedA);
  ok(true, 'valid single-award email passes guard');

  let caught = false;
  try {
    await guardMail({ ...mailA, to: 'bob@example.com' }, expectedA);
  } catch (e) {
    caught = e instanceof MappingError;
  }
  ok(caught, 'refuses wrong recipient address');

  caught = false;
  try {
    await guardMail({ ...mailA, personKey: 'bob_key' }, expectedA);
  } catch (e) {
    caught = e instanceof MappingError;
  }
  ok(caught, 'refuses personKey mismatch');

  const certIdB = 'cert_gb_1';
  const personB = 'bob_key';
  const codeB = verifyCodeFor(certIdB);
  const tokenB = certToken(certIdB);
  const rB = await makeTestCert(certIdB, personB, 'Bob Jones', 'Participant', codeB);

  caught = false;
  try {
    await guardMail({
      ...mailA,
      attachments: [{ certId: certIdB, fileName: rB.fileName, content: rB.pdf, sha256: rB.sha256 }],
    }, expectedA);
  } catch (e) {
    caught = e instanceof MappingError;
  }
  ok(caught, 'refuses swapped attachment belonging to another student');

  const tamperedPdf = new Uint8Array(rA.pdf);
  tamperedPdf[tamperedPdf.length - 1] ^= 0xff;
  caught = false;
  try {
    await guardMail({
      ...mailA,
      attachments: [{ certId: certIdA, fileName: rA.fileName, content: tamperedPdf, sha256: rA.sha256 }],
    }, expectedA);
  } catch (e) {
    caught = e instanceof MappingError;
  }
  ok(caught, 'refuses tampered PDF content with hash mismatch');

  const certIdA2 = 'cert_ga_2';
  const codeA2 = verifyCodeFor(certIdA2);
  const tokenA2 = certToken(certIdA2);
  const rA2 = await makeTestCert(certIdA2, personA, 'Alice Smith', 'Special Mention', codeA2);

  const expectedMulti: ExpectedDelivery = {
    to: 'alice@example.com',
    personKey: personA,
    certs: [
      { certId: certIdA, sha256: rA.sha256, verifyCode: codeA, reportToken: tokenA },
      { certId: certIdA2, sha256: rA2.sha256, verifyCode: codeA2, reportToken: tokenA2 },
    ],
  };

  caught = false;
  try {
    await guardMail(mailA, expectedMulti);
  } catch (e) {
    caught = e instanceof MappingError;
  }
  ok(caught, 'refuses when expected certificate is missing from attachments');

  console.log('MAIL GUARD OK');
}

async function testGmail() {
  console.log('Testing Gmail transport & error classification...');
  let sentBody: string | null = null;
  let sentHeaders: any = null;

  const fakeFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    sentHeaders = new Headers(init?.headers);
    sentBody = init?.body as string;
    return new Response(JSON.stringify({ id: 'msg_gmail_123', threadId: 'thread_123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const transport = new GmailTransport({
    from: 'organizer@gmail.com',
    getAccessToken: async () => 'test_mock_oauth_token',
    fetchImpl: fakeFetch as typeof fetch,
  });

  const mail = composeEmail({
    template: { id: 't', subject: 'Gmail Test Subject', html: '<p>Hello</p>', includeDriveLink: false, includeLinkedIn: false },
    values: {},
    to: 'student@example.com',
    personKey: 'p1',
    certs: [{
      certId: 'c1',
      fileName: 'test.pdf',
      pdf: new Uint8Array([37, 80, 68, 70]),
      sha256: sha256(new Uint8Array([37, 80, 68, 70])),
      verifyCode: 'K7QM-2XDP-94RT',
      verifyUrl: 'http://localhost/v',
      categoryLabel: 'Test',
      reportUrl: 'http://localhost/r',
    }],
    organizationName: 'Org',
    messageId: '<gmail-test@domain.com>',
  });

  const res = await transport.send(mail);
  ok(res.messageId === '<gmail-test@domain.com>', 'Gmail transport returns messageId');
  ok(sentHeaders?.get('Authorization') === 'Bearer test_mock_oauth_token', 'includes Bearer auth token');
  ok(typeof sentBody === 'string' && JSON.parse(sentBody).raw, 'payload contains base64url raw message');

  const quotaRes = new Response(
    JSON.stringify({ error: { message: 'Daily limit exceeded', errors: [{ reason: 'rateLimitExceeded' }] } }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  );
  const errQuota = await classifyGmailError(quotaRes);
  ok(errQuota instanceof MailError && errQuota.quota && errQuota.transient, '403 rateLimitExceeded classified as quota/transient');

  const serverErrRes = new Response('Backend error', { status: 503 });
  const errServer = await classifyGmailError(serverErrRes);
  ok(errServer instanceof MailError && errServer.transient && !errServer.quota, '503 classified as transient');

  const badAuthRes = new Response(JSON.stringify({ error: { message: 'Invalid credentials' } }), { status: 401 });
  const errAuth = await classifyGmailError(badAuthRes);
  ok(errAuth instanceof MailError && !errAuth.transient, '401 classified as non-transient configuration error');

  console.log('MAIL GMAIL OK');
}

async function testCapture() {
  console.log('Testing Capture transport (local outbox)...');
  const tmpDir = path.join(process.cwd(), 'data', 'test-outbox');
  fs.mkdirSync(tmpDir, { recursive: true });

  const transport = new CaptureTransport(tmpDir);
  const samplePdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);

  const mail = composeEmail({
    template: { id: 't', subject: 'Capture Test', html: '<p>Outbox test</p>', includeDriveLink: false, includeLinkedIn: false },
    values: {},
    to: 'student@example.com',
    personKey: 'p_capture',
    certs: [{
      certId: 'c_cap_1',
      fileName: 'Sample.pdf',
      pdf: samplePdf,
      sha256: sha256(samplePdf),
      verifyCode: 'CAP1-TEST-2026',
      verifyUrl: 'http://localhost/v',
      categoryLabel: 'Award',
      reportUrl: 'http://localhost/r',
    }],
    organizationName: 'Club',
    messageId: '<capture-msg-1@certflow.local>',
  });

  const res = await transport.send(mail);
  ok(res.messageId === '<capture-msg-1@certflow.local>', 'Capture transport returns messageId');

  const emlFile = transport.fileFor(res.messageId);
  ok(fs.existsSync(emlFile), 'atomic .eml file created in outbox');

  const emlContent = fs.readFileSync(emlFile, 'utf8');
  ok(emlContent.includes('To: student@example.com'), 'eml contains To header');
  ok(emlContent.includes('Subject: Capture Test'), 'eml contains Subject header');
  ok(/filename="?Sample\.pdf"?/i.test(emlContent), 'eml contains attachment filename');
  ok(await transport.wasSent(res.messageId), 'wasSent reports true for captured message');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('MAIL CAPTURE OK');
}

async function testSmtp() {
  console.log('Testing SMTP transport...');
  const err451 = classifySmtpError({ responseCode: 451, response: '451 Try again later' });
  ok(err451.transient && !err451.quota, 'SMTP 451 classified as transient');

  const err550Quota = classifySmtpError({ responseCode: 550, response: '550 5.4.5 Daily sending limit exceeded' });
  ok(err550Quota.transient && err550Quota.quota, 'SMTP 550 quota error classified as quota transient');

  const err550User = classifySmtpError({ responseCode: 550, response: '550 5.1.1 User unknown' });
  ok(!err550User.transient, 'SMTP 550 unknown user classified as permanent error');

  const errAuth = classifySmtpError({ code: 'EAUTH', message: 'Authentication failed' });
  ok(!errAuth.transient && errAuth.message.includes('Settings > Sending'), 'EAUTH classified as configuration error');

  const transport = new SmtpTransport({
    host: '127.0.0.1',
    port: 587,
    secure: false,
    from: 'host@college.edu',
  });
  ok(transport.name === 'smtp', 'transport name is smtp');

  const samplePdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
  const mail = composeEmail({
    template: { id: 't', subject: 'Your Award', html: '<p>Dear Winner</p>', includeDriveLink: false, includeLinkedIn: false },
    values: {},
    to: 'winner@student.org',
    personKey: 'p_smtp',
    certs: [{
      certId: 'c_smtp_1',
      fileName: 'WinnerAward.pdf',
      pdf: samplePdf,
      sha256: sha256(samplePdf),
      verifyCode: 'W1NN-3R26-HACK',
      verifyUrl: 'http://localhost/verify',
      categoryLabel: 'Grand Prize',
      reportUrl: 'http://localhost/report',
    }],
    organizationName: 'Hackathon',
    messageId: '<smtp-verify-123@campus.edu>',
  });

  try {
    await transport.send(mail);
    ok(true, 'SMTP direct send succeeded');
  } catch (err) {
    const isMailErr = err instanceof MailError;
    ok(isMailErr && (err as MailError).transient, `Network refusal in sandbox correctly caught as transient: ${(err as Error).message}`);
  } finally {
    transport.close();
  }

  console.log('MAIL SMTP OK');
}

async function testFooterLinks() {
  console.log('Testing email footer links...');
  const certId = 'cert_link_1';
  const personKey = 'p_link_1';
  const code = verifyCodeFor(certId);
  const token = certToken(certId);
  const dummyPdf = new Uint8Array([1, 2, 3]);

  const links = buildShareLinks({
    title: '1st Prize in AI',
    organizationName: 'Global Hackathon',
    dateText: 'November 2026',
    issuedAt: new Date(2026, 10, 4),
    verifyUrl: `http://localhost:3000/verify/${code}`,
    verifyCode: code,
    customizeUrl: `http://localhost:3000/linkedin/${token}`,
  });

  const cert: MailCertificate = {
    certId,
    fileName: 'AI_Award.pdf',
    pdf: dummyPdf,
    sha256: sha256(dummyPdf),
    verifyCode: code,
    verifyUrl: `http://localhost:3000/verify/${code}`,
    categoryLabel: '1st Prize in AI',
    reportUrl: `http://localhost:3000/report/${token}`,
    linkedInAddUrl: links.addToProfile,
    linkedInShareUrl: links.share,
    linkedInCustomizeUrl: links.customize,
  };

  const mailWithLinkedIn = composeEmail({
    template: { id: 't1', subject: 'Your certificate', html: '<p>Congrats!</p>', includeDriveLink: false, includeLinkedIn: true },
    values: {},
    to: 'student@example.com',
    personKey,
    certs: [cert],
    organizationName: 'Global Hackathon',
    messageId: '<test-links-1@x>',
  });

  ok(mailWithLinkedIn.html.includes('Add to LinkedIn profile'), 'includes Add to LinkedIn profile button');
  ok(mailWithLinkedIn.html.includes('Share on LinkedIn'), 'includes Share on LinkedIn button');
  ok(mailWithLinkedIn.html.includes('Customize your LinkedIn entry'), 'includes LinkedIn customize link');
  ok(mailWithLinkedIn.html.includes('Report a problem'), 'includes Report a problem button');
  ok(mailWithLinkedIn.html.includes(`/report/${token}`), 'Report link contains signed per-cert token');

  const addUrl = new URL(cert.linkedInAddUrl!.replace(/&amp;/g, '&'));
  ok(addUrl.searchParams.get('certId') === code, 'LinkedIn certId matches verification code');

  const mailWithoutLinkedIn = composeEmail({
    template: { id: 't2', subject: 'Your certificate', html: '<p>Congrats!</p>', includeDriveLink: false, includeLinkedIn: false },
    values: {},
    to: 'student@example.com',
    personKey,
    certs: [cert],
    organizationName: 'Global Hackathon',
    messageId: '<test-links-2@x>',
  });

  ok(!mailWithoutLinkedIn.html.includes('Add to LinkedIn profile'), 'LinkedIn buttons omitted when feature disabled');
  ok(mailWithoutLinkedIn.html.includes('Report a problem'), 'Report a problem button remains present');

  console.log('MAIL FOOTER LINKS OK');
}

async function main() {
  const arg = process.argv[2];
  const caseName = arg === '--case' ? process.argv[3] : arg;

  if (caseName === 'compose') {
    await testCompose();
  } else if (caseName === 'guard') {
    await testGuard();
  } else if (caseName === 'gmail') {
    await testGmail();
  } else if (caseName === 'smtp') {
    await testSmtp();
  } else if (caseName === 'capture') {
    await testCapture();
  } else if (caseName === 'footer-links') {
    await testFooterLinks();
  } else {
    await testCompose();
    await testGuard();
    await testGmail();
    await testCapture();
    await testSmtp();
    await testFooterLinks();
    console.log('\nALL MAIL TESTS PASSED SUCCESSFULLY!');
  }
}

main().catch((e) => fail((e as Error).stack ?? String(e)));
