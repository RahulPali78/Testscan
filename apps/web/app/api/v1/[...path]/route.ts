import { proxy } from '../../../../lib/session';
export const dynamic = 'force-dynamic';
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!path.length || path.some((part) => !/^[A-Za-z0-9_.:-]+$/.test(part)) || path[0] === 'auth') return new Response(null, { status: 404 });
  return proxy(request, '/v1/' + path.join('/'));
}
export { handle as GET, handle as POST, handle as DELETE };
