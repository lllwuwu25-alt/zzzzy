import { Readable } from 'node:stream';

/** Test-only in-process request boundary. No socket/listener is created.
 * This verifies the real handler and body/cookie/origin rules, not TCP/TLS deployment.
 */
export async function requestHandler(handler, url, init = {}) {
    const headers = new Headers(init.headers);
    const body = init.body === undefined ? undefined : Buffer.from(init.body);
    if (body && !headers.has('content-length')) headers.set('content-length', String(body.length));
    const req = Object.assign(Readable.from(body ? [body] : []), {
        url: new URL(url).pathname + new URL(url).search,
        method: init.method ?? 'GET',
        headers: Object.fromEntries(headers),
        socket: { remoteAddress: '127.0.0.1' },
    });
    const responseHeaders = new Headers();
    let status = 200, ended = false, contents;
    const res = {
        headersSent: false,
        setHeader(name, value) {
            responseHeaders.delete(name);
            for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(name, String(item));
        },
        writeHead(code, values = {}) { status = code; for (const [name, value] of Object.entries(values)) this.setHeader(name, value); this.headersSent = true; },
        end(value) { ended = true; contents = value; },
    };
    await handler(req, res);
    if (!ended) throw Error('Handler did not complete the response');
    return new Response(contents, { status, headers: responseHeaders });
}
