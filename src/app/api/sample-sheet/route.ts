import { NextRequest, NextResponse } from 'next/server';
import { SAMPLE_SHEET_CSV, DIRTY_SAMPLE_CSV } from '@/content/help';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const type = url.searchParams.get('type');
  const isDirty = type === 'dirty' || type === 'errors';

  const csv = isDirty ? DIRTY_SAMPLE_CSV : SAMPLE_SHEET_CSV;
  const filename = isDirty ? 'sample-with-mistakes.csv' : 'sample-students.csv';

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
