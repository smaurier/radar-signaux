import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Browser, chromium } from 'playwright';

const USER_AGENT_NAVIGATEUR =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Navigateur headless partage (Playwright/Chromium), utilise en repli
 * quand un fetch() simple se fait bloquer (403/429/503 -- fingerprinting
 * TLS/HTTP anti-bot, constate en direct sur plusieurs sites e-commerce FR
 * le 11/08, cf mentions-legales.service.ts). Un vrai navigateur a une
 * empreinte TLS/HTTP standard qui passe la ou undici (fetch Node) se fait
 * bloquer.
 *
 * Instance de navigateur partagee entre tous les appels (lancement lazy,
 * fermeture propre a l'arret de l'app) : lancer un navigateur par requete
 * serait beaucoup trop lent/coteux.
 */
@Injectable()
export class NavigateurService implements OnModuleDestroy {
  private readonly logger = new Logger(NavigateurService.name);
  private browser: Browser | null = null;
  private lancementEnCours: Promise<Browser> | null = null;

  private async getBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    if (!this.lancementEnCours) {
      this.lancementEnCours = chromium.launch({ headless: true });
    }
    this.browser = await this.lancementEnCours;
    return this.browser;
  }

  async fetchTexte(url: string, timeoutMs = 20000): Promise<string | null> {
    let context;
    try {
      const browser = await this.getBrowser();
      context = await browser.newContext({ userAgent: USER_AGENT_NAVIGATEUR, locale: 'fr-FR' });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      return await page.content();
    } catch (err) {
      this.logger.warn(`Navigateur : ${url} en echec (${(err as Error).message})`);
      return null;
    } finally {
      await context?.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) await this.browser.close();
  }
}
