/** Forme (partielle) d'un resultat de l'API Recherche d'entreprises (gratuite, sans cle). */
export interface RechercheEntreprisesResultA11y {
  siren: string;
  nom_complet?: string;
  activite_principale?: string; // code NAF
  categorie_entreprise?: string;
  tranche_effectif_salarie?: string; // code INSEE, ex. "11" = 10 a 19 salaries
  finances?: Record<string, { ca?: number; resultat_net?: number }>;
}

export interface RechercheEntreprisesResponseA11y {
  results: RechercheEntreprisesResultA11y[];
  total_results: number;
}
