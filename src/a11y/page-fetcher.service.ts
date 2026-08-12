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
      return { html: await response.text(), bloque: false };
    } catch (err) {
      this.logger.warn(`Fetch ${url} en echec, ignore (${(err as Error).message})`);
      return { html: null, bloque: false };
    }
  }
}
