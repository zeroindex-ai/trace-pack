import { db } from '@/db/client';
import { handleRollup } from '@/queries/rollup';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  return handleRollup(db(), req);
}
