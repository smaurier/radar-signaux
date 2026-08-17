import { Injectable, Logger } from '@nestjs/common';
import robotsParser from 'robots-parser';

const USER_AGENT = 'radar-signaux-bot';
const TIMEOUT_MS = 8000;

/**
 * Respect de robots.txt (mode Freelance a11y) -- TODO releve des le debut
 * du module (mentions-legales.service.ts) et enfin traite le 11/08.
 * Cf fiche CNIL du 19/06/2025 sur le scraping de donnees publiques :
 * respect de robots.txt = condition favorable explicitement citee.
 *
 * Convention adoptee : pas de robots.txt, ou robots.txt inaccessible =
 * autorise par defaut (convention standard du protocole -- l'absence de
 * fichier ne signifie pas une interdiction).
 *
 * Un cache par origine evite de re-telecharger robots.txt a chaque appel
 * (home + plusieurs chemins usuels + eventuel scan, tout sur le meme
 * domaine dans un run de pipeline).
 */
@Injectable()
export class RobotsService {
  private readonly logger = new Logger(RobotsService.name);
  private readonly cache = new Map<
    string,
    ReturnType<typeof robotsParser> | null
  >();

  async estAutorise(url: string): Promise<boolean> {
    try {
      const origine = new URL(url).origin;
      const robot = await this.recupererRobot(origine);
      if (!robot) return true; // pas de robots.txt ou inaccessible = autorise
      const autorise = robot.isAllowed(url, USER_AGENT);
      return autorise !== false; // undefined (regle ambigue) = autorise par defaut
    } catch {
      return true; // URL malformee ou erreur : ne pas bloquer sur une incertitude technique
    }
  }

  private async recupererRobot(origine: string) {
    if (this.cache.has(origine)) return this.cache.get(origine)!;

    const url = `${origine}/robots.txt`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) {
        this.cache.set(origine, null);
        return null;
      }
      const texte = await response.text();
      const robot = robotsParser(url, texte);
      this.cache.set(origine, robot);
      return robot;
    } catch (err) {
      this.logger.debug(
        `robots.txt ${url} inaccessible, autorise par defaut (${(err as Error).message})`,
      );
      this.cache.set(origine, null);
      return null;
    }
  }
}
