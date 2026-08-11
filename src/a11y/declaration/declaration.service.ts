import { Injectable, Logger } from '@nestjs/common';
import { PageFetcherService } from '../page-fetcher.service';

const CHEMINS_USUELS = [
  '/accessibilite',
  '/declaration-accessibilite',
  '/accessibility',
  '/a11y',
];

/**
 * 'conforme' | 'partiel' | 'non_conforme' : declaration TROUVEE, avec son
 *   statut annonce (le texte normalise RGAA/art.47 est "Accessibilite :
 *   totalement/partiellement/non conforme").
 * 'absente' : plusieurs pages lues avec succes (dont un rendu navigateur
 *   force, cf commentaire de classe), aucune declaration nulle part.
 * 'bloque' : au moins un blocage anti-bot explicite -- jamais confondu
 *   avec 'absente' (meme principe que pour l'extraction SIREN).
 * 'indetermine' : aucune page accessible, pas de blocage explicite non plus.
 */
export type StatutDeclaration = 'conforme' | 'partiel' | 'non_conforme' | 'absente' | 'bloque' | 'indetermine';

export interface ResultatDeclaration {
  statut: StatutDeclaration;
  sourceUrl: string | null;
}

/**
 * Detection de la declaration d'accessibilite (mode Freelance a11y, coeur
 * du MVP a11y). Format normalise RGAA/art.47 : mention obligatoire en
 * pied de page, texte "Accessibilite : totalement/partiellement/non
 * conforme", lien vers /accessibilite. Regime EAA strict (code conso,
 * PME) : l'info peut legalement etre dans les CGV/mentions legales plutot
 * qu'une page dediee -- d'ou la verification aussi sur ces pages.
 *
 * **Absence des 4 signaux (regex home, chemins usuels, CGV, mentions
 * legales) = tres forte probabilite de non-conformite declarative**,
 * grief n°1 des mises en demeure recensees dans l'etude de faisabilite
 * (cas Picard : absence totale de declaration).
 *
 * **SPA / contenu injecte en JS** : un fetch() simple qui ne trouve rien
 * n'est pas concluant si le footer est rendu cote client. Contrairement a
 * l'extraction SIREN (qui ne bascule sur navigateur qu'en cas de blocage
 * anti-bot), ici un rendu navigateur forc est TOUJOURS tente en dernier
 * recours avant de conclure 'absente' -- le cout supplementaire est
 * justifie par le risque d'un faux negatif sur ce signal precis (accuser
 * a tort une entreprise de n'avoir aucune declaration serait grave).
 */
@Injectable()
export class DeclarationService {
  private readonly logger = new Logger(DeclarationService.name);

  constructor(private readonly pageFetcher: PageFetcherService) {}

  async detecter(domaine: string): Promise<ResultatDeclaration> {
    const base = `https://${domaine}`;
    let unePageLue = false;
    let unBlocage = false;

    const home = await this.pageFetcher.fetchTexte(base);
    if (home.bloque) unBlocage = true;
    if (home.html) {
      unePageLue = true;
      const statut = this.chercherDeclaration(home.html);
      if (statut) return { statut, sourceUrl: base };

      // Suivre un lien "accessibilite" trouve dans la page, meme mecanisme
      // que pour les mentions legales -- decouvert necessaire en direct le
      // 11/08 : caroll.com a un lien "Declaration d'accessibilite
      // numerique" vers /fr_fr/accessibilite-numerique, absent de
      // CHEMINS_USUELS (chaque site nomme sa page differemment).
      const lienDeclaration = this.trouverLienAccessibilite(home.html, base);
      if (lienDeclaration) {
        const page = await this.pageFetcher.fetchTexte(lienDeclaration);
        if (page.bloque) unBlocage = true;
        if (page.html) {
          unePageLue = true;
          const statutPage = this.chercherDeclaration(page.html);
          if (statutPage) return { statut: statutPage, sourceUrl: lienDeclaration };
        }
      }
    }

    for (const chemin of CHEMINS_USUELS) {
      const url = base + chemin;
      const page = await this.pageFetcher.fetchTexte(url);
      if (page.bloque) unBlocage = true;
      if (!page.html) continue;
      unePageLue = true;
      const statut = this.chercherDeclaration(page.html);
      if (statut) return { statut, sourceUrl: url };
    }

    // Dernier recours : rendu navigateur force sur la home, pour le
    // contenu injecte en JS qu'un fetch() simple ne verrait jamais
    // (footer de SPA notamment).
    const rendu = await this.pageFetcher.fetchViaNavigateur(base);
    if (rendu) {
      unePageLue = true;
      const statut = this.chercherDeclaration(rendu);
      if (statut) return { statut, sourceUrl: `${base} (rendu navigateur)` };
    }

    if (unBlocage) return { statut: 'bloque', sourceUrl: null };
    if (unePageLue) return { statut: 'absente', sourceUrl: null };
    return { statut: 'indetermine', sourceUrl: null };
  }

  /** Meme logique que trouverLienMentionsLegales (URL d'abord, texte en repli). */
  private trouverLienAccessibilite(html: string, base: string): string | null {
    const regexHref = /href=["']([^"']*accessib[^"']*)["']/i;
    const matchHref = html.match(regexHref);
    if (matchHref) {
      try {
        return new URL(matchHref[1], base).toString();
      } catch {
        // URL malformee, on retente via le texte du lien ci-dessous
      }
    }

    const regexTexte = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*accessibilit.[^<]*)<\/a>/i;
    const match = html.match(regexTexte);
    if (!match) return null;
    try {
      return new URL(match[1], base).toString();
    } catch {
      return null;
    }
  }

  /**
   * Deux formulations reelles constatees le 11/08 (une seule ne suffit
   * pas) :
   * 1. "Accessibilite : totalement/partiellement/non conforme" (mention
   *    normalisee attendue en pied de page RGAA/art.47).
   * 2. "le site de X est {mot} conforme au Referentiel/RGAA" (formulation
   *    de la page de declaration elle-meme -- constate sur caroll.com,
   *    groupe Beaumanoir : "le site de Caroll est non conforme au
   *    Referentiel General d'Amelioration de l'Accessibilite (RGAA)").
   * Le point remplace les accents (encodage non garanti UTF-8, meme
   * raison que dans mentions-legales.service.ts).
   */
  private chercherDeclaration(html: string): StatutDeclaration | null {
    const texte = html.replace(/<[^>]+>/g, ' ');

    const match1 = texte.match(
      /accessibilit.\s*:?\s*(totalement|partiellement|non)\s*conforme/i,
    );
    const match2 = texte.match(
      /(totalement|partiellement|non)\s+conforme\s+(?:au|aux)\s+(?:r.f.rentiel|RGAA)/i,
    );
    const match = match1 ?? match2;
    if (!match) return null;

    const mot = match[1].toLowerCase();
    if (mot === 'totalement') return 'conforme';
    if (mot === 'partiellement') return 'partiel';
    return 'non_conforme';
  }
}
