import { proxy } from '../../../lib/session';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return proxy(request, '/v1/system'); }
