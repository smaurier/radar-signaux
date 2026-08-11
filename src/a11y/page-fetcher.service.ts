import { Injectable, Logger } from '@nestjs/common';
import { NavigateurService } from './navigateur.service';

const USER_AGENT = 'radar-signaux-bot/0.1 (+https://github.com/smaurier/radar-signaux)';
const TIMEOUT_MS = 15000;

export interface ResultatFetch {
  html: string | null;
  bloque: boolean;
}

/**
 * fetch() partage (mode Freelance a11y) : essaie un fetch() simple
 * d'abord (rapide), repli vers un navigateur headless (Playwright) sur
 * blocage explicite uniquement (403/429/503 -- fingerprinting TLS/HTTP
 * anti-bot, constate en direct le 11/08, pas une histoire de User-Agent).
 *
 * Extrait de MentionsLegalesService pour etre reutilise par
 * DeclarationService sans dupliquer la logique de repli.
 */
@Injectable()
export class PageFetcherService {
  private readonly logger = new Logger(PageFetcherService.name);

  constructor(private readonly navigateur: NavigateurService) {}

  async fetchTexte(url: string): Promise<ResultatFetch> {
    const direct = await this.fetchDirect(url);
    if (direct.html || !direct.bloque) return direct;

    const html = await this.navigateur.fetchTexte(url);
    return html ? { html, bloque: false } : { html: null, bloque: true };
  }

  /** Force le rendu navigateur (contenu injecte en JS, ex. footer de SPA). */
  async fetchViaNavigateur(url: string): Promise<string | null> {
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
      return { html: await response.text(), bloque: false };
    } catch (err) {
      this.logger.warn(`Fetch ${url} en echec, ignore (${(err as Error).message})`);
      return { html: null, bloque: false };
    }
  }
}
