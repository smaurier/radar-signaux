export interface InpiLoginResponse {
  token: string;
}

/**
 * Schema volontairement large (unknown) : la structure exacte du JSON
 * "formality" du RNE n'est pas documentee publiquement de facon fiable.
 * Voir InpiService.extractCapital() pour la strategie d'extraction
 * defensive (plusieurs chemins essayes + log de calibration).
 */
export type InpiCompanyResponse = Record<string, unknown>;
