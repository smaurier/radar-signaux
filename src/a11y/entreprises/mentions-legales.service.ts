import { Injectable, Logger } from '@nestjs/common';
import { NavigateurService } from '../navigateur.service';

// Identification explicite (cf fiche CNIL 19/06/2025 sur le scraping de
// donnees publiques : User-Agent identifie = condition favorable). TODO :
// respect de robots.txt pas encore implemente -- a faire avant tout
// passage a l'echelle (>quelques centaines de domaines).
const USER_AGENT = 'radar-signaux-bot/0.1 (+https://github.com/smaurier/radar-signaux)';
const TIMEOUT_MS = 15000;

const CHEMINS_USUELS = [
  '/mentions-legales',
  '/mentions-legales.html',
  '/fr/mentions-legales',
  '/legal',
  '/mentions',
];

/**
 * 'trouve' : SIREN identifie.
 * 'non_trouve' : au moins une page lue avec succes, aucun motif SIREN dedans.
 * 'bloque' : au moins une reponse 403/429/503 -- signe d'un WAF/anti-bot
 *   (constate en direct sur chaussea.com : Node fetch/undici recoit 403 la
 *   ou curl avec le meme User-Agent recoit 200 -- fingerprinting TLS/HTTP,
 *   pas une histoire de User-Agent). NE JAMAIS confondre avec "pas de
 *   SIREN" : dire "pas de declaration" alors qu'on n'a pas pu verifier
 *   serait un faux negatif dangereux en prospection.
 * 'indetermine' : aucune page accessible, aucun blocage explicite non plus
 *   (DNS, timeout, connexion refusee...).
 */
export type StatutExtraction = 'trouve' | 'non_trouve' | 'bloque' | 'indetermine';

export interface ResultatSiren {
  siren: string | null;
  sourceUrl: string | null;
  statut: StatutExtraction;
}

interface ResultatFetch {
  html: string | null;
  bloque: boolean;
}

/**
 * Extraction du SIREN depuis les mentions legales d'un site (mode
 * Freelance a11y). Pipeline inverse par rapport au mode Dev : ici on part
 * du domaine (CrUX) pour trouver le SIREN, pas l'inverse (SIRENE n'a pas
 * les sites web -- cf etude de faisabilite du 01/08).
 *
 * Strategie : (1) chercher un lien "mentions legales" dans le HTML de la
 * home, (2) sinon essayer les chemins usuels, (3) chercher un motif SIREN
 * (ou SIRET, dont on garde les 9 premiers chiffres) sur la page trouvee.
 */
@Injectable()
export class MentionsLegalesService {
  private readonly logger = new Logger(MentionsLegalesService.name);

  constructor(private readonly navigateur: NavigateurService) {}

  async extraireSiren(domaine: string): Promise<ResultatSiren> {
    const base = `https://${domaine}`;
    let unePageLue = false;
    let unBlocage = false;

    const home = await this.fetchTexte(base);
    if (home.bloque) unBlocage = true;
    if (home.html) {
      unePageLue = true;
      const siren = this.chercherSiren(home.html);
      if (siren) return { siren, sourceUrl: base, statut: 'trouve' };

      const lienMentions = this.trouverLienMentionsLegales(home.html, base);
      if (lienMentions) {
        const page = await this.fetchTexte(lienMentions);
        if (page.bloque) unBlocage = true;
        if (page.html) {
          unePageLue = true;
          const sirenPage = this.chercherSiren(page.html);
          if (sirenPage) return { siren: sirenPage, sourceUrl: lienMentions, statut: 'trouve' };
        }
      }
    }

    for (const chemin of CHEMINS_USUELS) {
      const url = base + chemin;
      const page = await this.fetchTexte(url);
      if (page.bloque) unBlocage = true;
      if (!page.html) continue;
      unePageLue = true;
      const siren = this.chercherSiren(page.html);
      if (siren) return { siren, sourceUrl: url, statut: 'trouve' };
    }

    if (unBlocage) return { siren: null, sourceUrl: null, statut: 'bloque' };
    if (unePageLue) return { siren: null, sourceUrl: null, statut: 'non_trouve' };
    return { siren: null, sourceUrl: null, statut: 'indetermine' };
  }

  /**
   * fetch() simple d'abord (rapide, peu couteux) ; en cas de blocage
   * (403/429/503, cf commentaire de StatutExtraction), un seul repli via
   * navigateur headless -- pas de repli sur simple erreur/timeout, pour ne
   * pas systematiquement payer le cout du navigateur sur des sites juste
   * indisponibles.
   */
  private async fetchTexte(url: string): Promise<ResultatFetch> {
    const direct = await this.fetchDirect(url);
    if (direct.html || !direct.bloque) return direct;

    const html = await this.navigateur.fetchTexte(url);
    return html ? { html, bloque: false } : { html: null, bloque: true };
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

  private trouverLienMentionsLegales(html: string, base: string): string | null {
    // Priorite 1 : le mot "mentions" dans l'URL elle-meme (le slug), pas
    // dans le texte visible du lien -- plus robuste que le texte, qui peut
    // etre mal encode (accent -> caractere de remplacement, constate en
    // direct sur chaussea.com) ou enveloppe dans des balises imbriquees
    // (icones, spans) que le texte brut ne capte pas.
    const regexHref = /href=["']([^"']*mentions[^"']*)["']/i;
    const matchHref = html.match(regexHref);
    if (matchHref) {
      try {
        return new URL(matchHref[1], base).toString();
      } catch {
        // URL malformee, on retente via le texte du lien ci-dessous
      }
    }

    // Priorite 2 (repli) : texte visible du lien. "l.gales" (point =
    // e/e-accent/remplacement) pour la meme raison d'encodage que ci-dessus.
    const regexTexte = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*mentions?\s*l.gales?[^<]*)<\/a>/i;
    const match = html.match(regexTexte);
    if (!match) return null;
    try {
      return new URL(match[1], base).toString();
    } catch {
      return null;
    }
  }

  /** SIREN direct, ou SIRET (14 chiffres, on garde les 9 premiers = SIREN). */
  private chercherSiren(html: string): string | null {
    const texte = html.replace(/<[^>]+>/g, ' '); // degrossissage : retire les balises pour limiter les faux positifs sur des attributs

    const sirenMatch = texte.match(/SIREN\s*:?\s*(\d{3}[\s.]?\d{3}[\s.]?\d{3})\b/i);
    if (sirenMatch) return sirenMatch[1].replace(/\D/g, '');

    const siretMatch = texte.match(/SIRET\s*:?\s*(\d{3}[\s.]?\d{3}[\s.]?\d{3}[\s.]?\d{5})\b/i);
    if (siretMatch) return siretMatch[1].replace(/\D/g, '').slice(0, 9);

    const rcsMatch = texte.match(/RCS\s+[A-ZÀ-Ÿa-zà-ÿ\s\-']{2,30}\s(\d{3}[\s.]?\d{3}[\s.]?\d{3})\b/);
    if (rcsMatch) return rcsMatch[1].replace(/\D/g, '');

    return null;
  }
}
