/** Forme (partielle) d'un resultat de l'API Recherche d'entreprises (gratuite, sans cle). */
export interface RechercheEntreprisesResult {
  siren: string;
  activite_principale?: string; // code NAF, ex. "62.01Z"
  section_activite_principale?: string; // ex. "J" (information et communication)
  categorie_entreprise?: string; // TPE / PME / ETI / GE
  tranche_effectif_salarie?: string; // code INSEE, ex. "11" = 10 a 19 salaries
  date_creation?: string;
}

export interface RechercheEntreprisesResponse {
  results: RechercheEntreprisesResult[];
  total_results: number;
}
