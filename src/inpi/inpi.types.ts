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

/** Un acte tel que liste par GET /companies/{siren}/attachments. */
export interface InpiActe {
  id: string;
  dateDepot: string;
  typeDocument?: string;
  libelle?: string;
  nomDocument?: string;
}

export interface InpiAttachmentsResponse {
  actes?: InpiActe[];
  bilans?: unknown[];
  bilansSaisis?: unknown[];
}
