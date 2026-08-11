/** Forme (partielle) d'un enregistrement de l'API BODACC Opendatasoft v2.1. */
export interface BodaccApiRecord {
  dateparution: string;
  familleavis_lib?: string;
  typeavis?: string;
  commercant?: string;
  registre?: string | string[];
  numerodepartement?: string;
  // l'API renvoie parfois un nombre (84.0) plutot qu'une chaine
  region_code?: string | number | (string | number)[];
  tribunal?: string;
  modificationsgenerales?: string;
}

export interface BodaccApiResponse {
  total_count: number;
  results: BodaccApiRecord[];
}
