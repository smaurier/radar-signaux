import { PageFetcherService } from './page-fetcher.service';

/**
 * Test du vrai correctif du 13/08 : `response.text()` du Fetch standard
 * decode TOUJOURS en UTF-8, quel que soit l'encodage reel de la page --
 * c'etait la vraie cause du mojixage sur les mentions legales non-UTF-8
 * ("legales" -> caractere de remplacement, contourne jusque-la par des
 * regex a joker plutot que corrige a la source). Ces tests construisent de
 * vrais octets ISO-8859-1/Windows-1252 (pas une simulation) et verifient
 * que `decoderHtml` les redecode correctement.
 */
describe('PageFetcherService - decodage charset', () => {
  // navigateur/robots non utilises par decoderHtml/detecterCharset
  // (methodes pures) -- dependances non fournies volontairement
  const service = new PageFetcherService(undefined as never, undefined as never);
  const decoder = (buffer: ArrayBuffer, contentType: string | null) =>
    (
      service as unknown as {
        decoderHtml: (b: ArrayBuffer, c: string | null) => string;
      }
    ).decoderHtml(buffer, contentType);

  const versArrayBuffer = (buf: Buffer): ArrayBuffer =>
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  it('decode un buffer UTF-8 correctement sans aucun indice de charset (comportement par defaut inchange)', () => {
    const buffer = versArrayBuffer(Buffer.from('<p>mentions légales</p>', 'utf-8'));
    expect(decoder(buffer, null)).toContain('mentions légales');
  });

  it('decode un buffer ISO-8859-1 grace au charset du header Content-Type (le vrai bug corrige)', () => {
    // "légales" encode en ISO-8859-1 : bytes reels, pas une simulation --
    // response.text() (comportement precedent) aurait decode ces memes
    // octets en UTF-8 et produit un caractere de remplacement pour "é".
    const buffer = versArrayBuffer(Buffer.from('<p>mentions légales</p>', 'latin1'));
    expect(decoder(buffer, 'text/html; charset=iso-8859-1')).toContain('mentions légales');
  });

  it('decode un buffer ISO-8859-1 via le <meta charset> quand le header Content-Type est absent', () => {
    const html = '<html><head><meta charset="iso-8859-1"></head><body>légales</body></html>';
    const buffer = versArrayBuffer(Buffer.from(html, 'latin1'));
    expect(decoder(buffer, null)).toContain('légales');
  });

  it('decode un buffer Windows-1252 (variante courante de ISO-8859-1) via le header', () => {
    const buffer = versArrayBuffer(Buffer.from('<p>société à responsabilité</p>', 'latin1'));
    expect(decoder(buffer, 'text/html; charset=windows-1252')).toContain('société à responsabilité');
  });

  it('replie sur UTF-8 sans planter si le charset annonce est invalide', () => {
    const buffer = versArrayBuffer(Buffer.from('<p>texte utf-8 normal</p>', 'utf-8'));
    expect(() => decoder(buffer, 'text/html; charset=ce-charset-nexiste-pas')).not.toThrow();
    expect(decoder(buffer, 'text/html; charset=ce-charset-nexiste-pas')).toContain(
      'texte utf-8 normal',
    );
  });
});
