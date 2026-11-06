import { notFound, withApi } from '../../_shared';
import { verifyData } from '../../_public';

export const dynamic = 'force-dynamic';

export const GET = withApi<{ code: string }>(async ({ db, params }) => {
  const d = verifyData(db, params.code);
  if (!d) throw notFound('No certificate was found with that code. Check the code and try again.');
  return {
    valid: d.valid, revoked: d.revoked, name: d.name, event: d.event, award: d.award, date: d.date, issuer: d.issuer, code: d.code, imageUrl: d.imagePath, pdfUrl: d.pdfPath,
    issuedAt: d.issuedAt, sha256: d.sha256, proof: d.proof, linkedIn: d.linkedIn,
  };
}, { auth: false });
