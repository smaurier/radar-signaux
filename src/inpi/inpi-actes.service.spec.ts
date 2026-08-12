import { InpiActesService } from './inpi-actes.service';

/**
 * Tests bases sur le vrai texte extrait du PDF Galeon (11/08/2026, PV du
 * Conseil d'Administration du 28/07/2026) -- valide en direct a l'epoque,
 * fige ici pour eviter une regression sur l'extraction sens/montant.
 */
describe('InpiActesService', () => {
  const service = new InpiActesService(undefined as never, undefined as never);
  const parserCapital = (texte: string) =>
    (
      service as unknown as {
        parserCapital: (t: string) => {
          sens: string | null;
          capitalAvant: number | null;
          capitalApres: number | null;
          erreur: string | null;
        };
      }
    ).parserCapital(texte);

  it('extrait sens=hausse + montants avant/apres sur le vrai texte Galeon', () => {
    const texteGaleon = `
      GALEON
      Société anonyme au capital de 37.400 euros
      EXTRAIT DE PROCÈS-VERBAL DES DÉLIBÉRATIONS DU CONSEIL D'ADMINISTRATION
      Augmentation de Capital d'un montant nominal de 1.626,31656 euros
      Constatation de la réalisation définitive de l'Augmentation de Capital
      que le capital social de la Société s'élève désormais à 39.026,31656 euros
    `;
    const resultat = parserCapital(texteGaleon);
    expect(resultat.sens).toBe('hausse');
    expect(resultat.capitalAvant).toBeCloseTo(37400);
    expect(resultat.capitalApres).toBeCloseTo(39026.31656);
    expect(resultat.erreur).toBeNull();
  });

  it('detecte le sens "baisse" sur "Reduction de Capital"', () => {
    const resultat = parserCapital('Le Conseil decide une Réduction de Capital de la société.');
    expect(resultat.sens).toBe('baisse');
  });

  it('tolere une apostrophe typographique dans "s\'eleve" (bug corrige le 11/08)', () => {
    // le texte reel utilise une apostrophe typographique (’, U+2019), pas
    // l'apostrophe ASCII -- la premiere version de la regex la ratait
    const texte = "que le capital social s’élève désormais à 39.026,31656 euros";
    const resultat = parserCapital(texte);
    expect(resultat.capitalApres).toBeCloseTo(39026.31656);
  });

  it('ne trouve rien sur un texte sans formulation reconnue -> erreur explicite', () => {
    const resultat = parserCapital('Ceci est un document sans rapport avec le capital social.');
    expect(resultat.sens).toBeNull();
    expect(resultat.capitalAvant).toBeNull();
    expect(resultat.capitalApres).toBeNull();
    expect(resultat.erreur).not.toBeNull();
  });
});
