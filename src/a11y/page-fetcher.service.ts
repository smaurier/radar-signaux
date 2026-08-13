import { Injectable, Logger } from '@nestjs/common';
import { NavigateurService } from './navigateur.service';
import { RobotsService } from './robots.service';

const USER_AGENT = 'radar-signaux-bot/0.1 (+https://github.com/smaurier/radar-signaux)';
const TIMEOUT_MS = 15000;

export interface ResultatFetch {
  html: string | null;
  bloque: boolean;
}

/**
 * fetch() partage (mode Freelance a11y) : verifie robots.txt d'abord
 * (jamais contourne -- cf RobotsService), puis essaie un fetch() simple
 * (rapide), repli vers un navigateur headless (Playwright) sur blocage
 * explicite uniquement (403/429/503 -- fingerprinting TLS/HTTP anti-bot,
 * constate en direct le 11/08, pas une histoire de User-Agent).
 *
 * Un disallow robots.txt est traite avec la MEME semantique que
 * "bloque" (403 etc.) en aval : dans les deux cas on n'a pas pu/voulu
 * consulter la page, jamais confondu avec "rien trouve" -- juste que
 * l'un est un blocage serveur, l'autre un blocage qu'on s'impose
 * volontairement. Le log distingue les deux pour la tracabilite.
 *
 * Extrait de MentionsLegalesService pour etre reutilise par
 * DeclarationService sans dupliquer la logique de repli.
 */
@Injectable()
export class PageFetcherService {
  private readonly logger = new Logger(PageFetcherService.name);

  constructor(
    private readonly navigateur: NavigateurService,
    private readonly robots: RobotsService,
  ) {}

  async fetchTexte(url: string): Promise<ResultatFetch> {
    if (!(await this.robots.estAutorise(url))) {
      this.logger.debug(`robots.txt interdit ${url}, ignore.`);
      return { html: null, bloque: true };
    }

    const direct = await this.fetchDirect(url);
    if (direct.html || !direct.bloque) return direct;

    const html = await this.navigateur.fetchTexte(url);
    return html ? { html, bloque: false } : { html: null, bloque: true };
  }

  /** Force le rendu navigateur (contenu injecte en JS, ex. footer de SPA). */
  async fetchViaNavigateur(url: string): Promise<string | null> {
    if (!(await this.robots.estAutorise(url))) {
      this.logger.debug(`robots.txt interdit ${url} (rendu navigateur), ignore.`);
      return null;
    }
    return this.navigateur.fetchTexte(url);
  }

  private async fetchDirect(url: string): Promise<ResultatFetch> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'fr-FR,fr;q=0.9',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);
      if (response.status === 403 || response.status === 429 || response.status === 503) {
        return { html: null, bloque: true };
      }
      if (!response.ok) return { html: null, bloque: false };
      const buffer = await response.arrayBuffer();
      const html = this.decoderHtml(buffer, response.headers.get('content-type'));
      return { html, bloque: false };
    } catch (err) {
      this.logger.warn(`Fetch ${url} en echec, ignore (${(err as Error).message})`);
      return { html: null, bloque: false };
    }
  }

  /**
   * `response.text()` du Fetch standard decode TOUJOURS en UTF-8, quel que
   * soit l'encodage reel de la page (ignore le charset du Content-Type ET le
   * `<meta charset>`) -- c'est la vraie cause du mojibake constate le 11/08
   * sur des mentions legales servies en encodage non-UTF-8 ("legales" ->
   * caractere de remplacement), pas seulement un souci de regex trop
   * stricte. Fix : lire le buffer brut, detecter le charset (header
   * Content-Type, sinon `<meta charset>` dans les premiers octets, sinon
   * UTF-8 par defaut) et decoder avec le bon `TextDecoder`. Les regex a
   * joker (`l.gales?`) restent en place ailleurs en defense-en-profondeur --
   * un site mal configure peut toujours annoncer un charset faux.
   */
  private decoderHtml(buffer: ArrayBuffer, contentType: string | null): string {
    const charset = this.detecterCharset(buffer, contentType);
    try {
      return new TextDecoder(charset).decode(buffer);
    } catch {
      // Charset annonce invalide/non supporte par l'ICU de Node -- repli
      // UTF-8 (comportement precedent, jamais pire qu'avant ce correctif).
      return new TextDecoder('utf-8').decode(buffer);
    }
  }

  private detecterCharset(buffer: ArrayBuffer, contentType: string | null): string {
    const depuisHeader = contentType?.match(/charset=([^;]+)/i)?.[1];
    if (depuisHeader) return depuisHeader.trim().toLowerCase();

    // `<meta charset>` : les octets ASCII (dont ce motif) sont identiques
    // dans toutes les codepages usuelles (UTF-8, Latin-1, Windows-1252...),
    // donc un decodage UTF-8 non strict des premiers octets suffit pour
    // lire cette seule declaration, meme si le vrai charset est different.
    const debut = new TextDecoder('utf-8').decode(buffer.slice(0, 1024));
    const metaCharset =
      debut.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ??
      debut.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i)?.[1];
    if (metaCharset) return metaCharset.trim().toLowerCase();

    return 'utf-8';
  }
}
