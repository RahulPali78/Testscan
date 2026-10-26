import { proxy } from '../../../../lib/session';
export function POST(request: Request) { return proxy(request, '/v1/scenarios/validate'); }
