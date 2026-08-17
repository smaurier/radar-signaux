import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ArgumentaireService } from './argumentaire.service';
import { A11yStorageService } from '../storage/a11y-storage.service';

interface RowProspect {
  domaine: string;
  nom_complet: string | null;
  siren: string | null;
  naf_code: string | null;
  ca: number | null;
  statut_declaration: string | null;
  source_url_declaration: string | null;
  scan_total_violations: number | null;
  scan_top_violations: string | null;
}

@Controller('a11y/argumentaire')
export class ArgumentaireController {
  constructor(
    private readonly argumentaire: ArgumentaireService,
    private readonly storage: A11yStorageService,
  ) {}

  /** Genere l'argumentaire pour un domaine deja traite par le pipeline. */
  @Get()
  generer(@Query('domaine') domaine: string) {
    const rows = this.storage.listerRecent(500) as RowProspect[];
    const row = rows.find((r) => r.domaine === domaine);
    if (!row) {
      throw new NotFoundException(
        `Domaine ${domaine} pas encore traite par le pipeline a11y.`,
      );
    }
    return this.argumentaire.genererArgumentaire({
      domaine: row.domaine,
      nomComplet: row.nom_complet,
      siren: row.siren,
      nafCode: row.naf_code,
      ca: row.ca,
      statutDeclaration: row.statut_declaration,
      sourceUrlDeclaration: row.source_url_declaration,
      scanTotalViolations: row.scan_total_violations,
      scanTopViolations: row.scan_top_violations,
    });
  }
}
