import { Devise, lireTitre } from './titre-levee';

export interface ItemDeFlux {
  title?: string;
  link?: string;
  isoDate?: string;
}

export interface ArticlePresse {
  url: string;
  source: string;
  publieLe: string | null;
  titre: string;
  /** null : le titre ne dit rien, l'article reste a lire. */
  genre: 'levee' | 'recap' | null;
  nom: string | null;
  montant: number | null;
  devise: Devise | null;
}

/**
 * Garde TOUS les articles du flux, pas seulement ceux dont le titre parle
 * d'une levee : certains titres ne la mentionnent pas du tout (cas reel du
 * 10/11/2026), seule la lecture de l'article la revelera.
 */
export function versArticles(
  source: string,
  items: readonly ItemDeFlux[],
): ArticlePresse[] {
  return items.flatMap((item) => {
    const titre = item.title?.trim();
    if (!titre || !item.link) {
      return [];
    }
    const lecture = lireTitre(titre);
    return [
      {
        url: item.link,
        source,
        publieLe: item.isoDate ?? null,
        titre,
        genre: lecture?.genre ?? null,
        nom: lecture?.nom ?? null,
        montant: lecture?.montant?.valeur ?? null,
        devise: lecture?.montant?.devise ?? null,
      },
    ];
  });
}
