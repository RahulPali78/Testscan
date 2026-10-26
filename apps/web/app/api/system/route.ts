import { SystemSnapshotSchema } from '@veriqo/contracts';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const upstream = new URL('/v1/system', process.env.VERIQO_API_URL ?? 'http://127.0.0.1:4000');
    const response = await fetch(upstream, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Upstream unavailable');
    const snapshot = SystemSnapshotSchema.parse(await response.json());
    return Response.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      { code: 'API_UNAVAILABLE', message: 'The control API is unavailable. Start the local services and retry.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
