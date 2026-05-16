import { db } from '@/db/client';
import { handleIngest } from '@/ingest/handler';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  return handleIngest(db(), req);
}
