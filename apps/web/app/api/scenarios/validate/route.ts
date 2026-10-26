import { ScenarioValidationSchema } from '@veriqo/contracts';

export async function POST(request: Request) {
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 65536) {
          await reader.cancel();
          return Response.json({ code: 'REQUEST_TOO_LARGE', message: 'Keep scenarios below 64 KiB.' }, { status: 413 });
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } catch {
      return Response.json({ code: 'INVALID_REQUEST', message: 'The request body could not be read.' }, { status: 400 });
    } finally {
      reader.releaseLock();
    }
  }
  try {
    JSON.parse(text);
  } catch {
    return Response.json({ code: 'INVALID_JSON', message: 'Enter valid JSON before validating the scenario.' }, { status: 400 });
  }
  try {
    const upstream = new URL('/v1/scenarios/validate', process.env.VERIQO_API_URL ?? 'http://127.0.0.1:4000');
    const response = await fetch(upstream, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text,
      cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 200 && response.status !== 400) throw new Error('Upstream unavailable');
    const result = ScenarioValidationSchema.parse(await response.json());
    return Response.json(result, { status: result.valid ? 200 : 400 });
  } catch {
    return Response.json(
      { code: 'API_UNAVAILABLE', message: 'The control API is unavailable. Start the local services and retry.' },
      { status: 503 },
    );
  }
}
